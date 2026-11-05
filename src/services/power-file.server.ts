import { createHash, randomUUID } from "node:crypto";

import { and, between, desc, eq, or } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, athleteMetrics, powerFiles } from "@/db/schema.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import {
  buildPowerFileAnalysis,
  isPowerFileAnalysis,
  pedalingFrom,
  emptyPedalSums,
  mergePedalSums,
  powerFileView,
  type PowerFileAnalysis,
} from "./power-file-analysis.ts";
import { fitBytes, PowerFileRejected, readFitRide } from "./power-file-fit.server.ts";
import type {
  MatchedActivity,
  PowerFileDetail,
  PowerFileImport,
  PowerFileListItem,
} from "./power-file.ts";
import { isCyclingSport } from "./training-load.ts";

/** Strava and the head unit may start a ride a little apart. */
const MATCH_WINDOW_MS = 5 * 60_000;
/** A ride's FIT file is a few megabytes; Garmin's zip is smaller. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

type PowerFileSummary = Omit<PowerFileListItem, "id" | "fileName" | "start" | "activity">;

function summaryOf(analysis: PowerFileAnalysis): PowerFileSummary {
  const overall = emptyPedalSums();
  for (const [, bin] of analysis.powerBins) mergePedalSums(overall, bin);
  return {
    sportType: analysis.sportType,
    distanceM: analysis.distanceM,
    movingSec: analysis.movingSec,
    avgWatts: analysis.power.avg,
    normalizedWatts: analysis.power.normalized,
    rightPct: pedalingFrom(overall).rightPct,
  };
}

function nearest<T extends { startDate: Date }>(rows: T[], start: Date) {
  let best: T | null = null;
  for (const row of rows) {
    const gap = Math.abs(row.startDate.getTime() - start.getTime());
    if (gap > MATCH_WINDOW_MS) continue;
    if (!best || gap < Math.abs(best.startDate.getTime() - start.getTime())) best = row;
  }
  return best;
}

function window(column: typeof activities.startDate | typeof powerFiles.startDate, start: Date) {
  return between(
    column,
    new Date(start.getTime() - MATCH_WINDOW_MS),
    new Date(start.getTime() + MATCH_WINDOW_MS),
  );
}

/** Each start's synced ride, found by start time; Strava never sees the imported file. */
async function matchActivities(userId: string, starts: Date[]) {
  const matches = new Map<number, MatchedActivity>();
  if (!starts.length) return matches;
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      sportType: activities.sportType,
      startDate: activities.startDate,
    })
    .from(activities)
    .where(
      and(
        eq(activities.userId, userId),
        or(...starts.map((start) => window(activities.startDate, start))),
      ),
    );
  const rides = rows.filter((row) => isCyclingSport(row.sportType));
  for (const start of starts) {
    const match = nearest(rides, start);
    if (match) matches.set(start.getTime(), { id: match.id, name: match.name });
  }
  return matches;
}

/** The imported file of a synced ride, for the link from its activity page. */
export async function powerFileIdFor(userId: string, sportType: string, start: Date) {
  if (!isCyclingSport(sportType)) return null;
  const rows = await db
    .select({ id: powerFiles.id, startDate: powerFiles.startDate })
    .from(powerFiles)
    .where(and(eq(powerFiles.userId, userId), window(powerFiles.startDate, start)));
  return nearest(rows, start)?.id ?? null;
}

export async function loadPowerFiles(userId: string): Promise<PowerFileListItem[]> {
  const rows = await db
    .select({
      id: powerFiles.id,
      fileName: powerFiles.fileName,
      startDate: powerFiles.startDate,
      summary: powerFiles.summary,
    })
    .from(powerFiles)
    .where(eq(powerFiles.userId, userId))
    .orderBy(desc(powerFiles.startDate));
  const matches = await matchActivities(
    userId,
    rows.map((row) => row.startDate),
  );
  return rows.map((row) => ({
    ...(row.summary as PowerFileSummary),
    id: row.id,
    fileName: row.fileName,
    start: row.startDate.toISOString(),
    activity: matches.get(row.startDate.getTime()) ?? null,
  }));
}

/** The stored analysis, or a new one read from the stored file when VO2's analysis changed. */
async function currentAnalysis(id: string, stored: unknown) {
  if (isPowerFileAnalysis(stored)) return stored;
  const [row] = await db
    .select({ file: powerFiles.file })
    .from(powerFiles)
    .where(eq(powerFiles.id, id))
    .limit(1);
  const analysis = buildPowerFileAnalysis(readFitRide(new Uint8Array(row!.file)));
  await db
    .update(powerFiles)
    .set({ analysis, summary: summaryOf(analysis) })
    .where(eq(powerFiles.id, id));
  logger.info("power_file.reanalysed", { powerFileId: id });
  return analysis;
}

export async function listPowerFilesImpl() {
  const session = await getRequiredSession();
  return loadPowerFiles(session.user.id);
}

/** One of the athlete's power files, read with their current FTP and weight. */
export async function loadPowerFile(userId: string, id: string): Promise<PowerFileDetail | null> {
  const [row] = await db
    .select({
      id: powerFiles.id,
      fileName: powerFiles.fileName,
      startDate: powerFiles.startDate,
      analysis: powerFiles.analysis,
      createdAt: powerFiles.createdAt,
      ftp: athleteMetrics.ftp,
      weightKg: athleteMetrics.weightKg,
    })
    .from(powerFiles)
    .leftJoin(athleteMetrics, eq(athleteMetrics.userId, powerFiles.userId))
    .where(and(eq(powerFiles.id, id), eq(powerFiles.userId, userId)))
    .limit(1);
  if (!row) return null;
  const analysis = await currentAnalysis(row.id, row.analysis);
  const matches = await matchActivities(userId, [row.startDate]);
  return {
    id: row.id,
    fileName: row.fileName,
    importedAt: row.createdAt.toISOString(),
    activity: matches.get(row.startDate.getTime()) ?? null,
    analysis: powerFileView(analysis, { ftp: row.ftp, weightKg: row.weightKg }),
  };
}

export async function getPowerFileImpl(id: string) {
  const session = await getRequiredSession();
  return loadPowerFile(session.user.id, id);
}

async function existingId(userId: string, fileHash: string) {
  const [row] = await db
    .select({ id: powerFiles.id })
    .from(powerFiles)
    .where(and(eq(powerFiles.userId, userId), eq(powerFiles.fileHash, fileHash)))
    .limit(1);
  return row?.id ?? null;
}

export async function importPowerFileImpl(form: FormData): Promise<PowerFileImport> {
  const session = await getRequiredSession();
  const upload = form.get("file");
  if (!(upload instanceof File)) return { status: "rejected", reason: "No file was sent." };
  if (upload.size > MAX_UPLOAD_BYTES) {
    return { status: "rejected", reason: "This file is too big to be a ride (over 50 MB)." };
  }
  const startedAt = performance.now();
  let bytes: Uint8Array;
  let analysis: PowerFileAnalysis;
  try {
    bytes = fitBytes(new Uint8Array(await upload.arrayBuffer()));
    analysis = buildPowerFileAnalysis(readFitRide(bytes));
  } catch (error) {
    if (error instanceof PowerFileRejected) return { status: "rejected", reason: error.message };
    logger.warn("power_file.unreadable", errorFields(error));
    return { status: "rejected", reason: "This file could not be read as a FIT file." };
  }

  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const userId = session.user.id;
  const known = await existingId(userId, fileHash);
  if (known) return { status: "duplicate", id: known };

  const id = randomUUID();
  const inserted = await db
    .insert(powerFiles)
    .values({
      id,
      userId,
      fileName: upload.name.slice(0, 200) || "ride.fit",
      fileHash,
      file: Buffer.from(bytes),
      startDate: new Date(analysis.start),
      summary: summaryOf(analysis),
      analysis,
    })
    .onConflictDoNothing({ target: [powerFiles.userId, powerFiles.fileHash] })
    .returning({ id: powerFiles.id });
  // The same file sent twice at once: the other request saved it first.
  if (!inserted.length) return { status: "duplicate", id: (await existingId(userId, fileHash))! };
  logger.info("power_file.imported", {
    powerFileId: id,
    bytes: bytes.byteLength,
    samples: analysis.quality.samples,
    ms: Math.round(performance.now() - startedAt),
  });
  return { status: "imported", id };
}

export async function deletePowerFileImpl(id: string) {
  const session = await getRequiredSession();
  await db
    .delete(powerFiles)
    .where(and(eq(powerFiles.id, id), eq(powerFiles.userId, session.user.id)));
  logger.info("power_file.deleted", { powerFileId: id });
}
