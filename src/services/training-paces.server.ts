import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { ensureBestEfforts } from "./best-efforts.server.ts";
import {
  ESTIMATE_WINDOW_DAYS,
  estimateVdot,
  parseRaceResult,
  trainingPaces,
  type RaceResult,
  type RunEffort,
  type TrainingPaces,
} from "./training-paces.types.ts";

/**
 * Best efforts from road runs in the estimate window. Hidden sport types count: hiding changes
 * views, not the athlete's fitness (ADR 0018).
 */
async function recentRunEfforts(userId: string, now: Date): Promise<RunEffort[]> {
  const since = new Date(now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      sportType: activities.sportType,
      startDate: activities.startDate,
      deviceWatts: activities.deviceWatts,
      streamId: activityStreams.activityId,
      bestEfforts: activityStreams.bestEfforts,
    })
    .from(activities)
    .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(
      and(
        eq(activities.userId, userId),
        eq(activities.sportType, "Run"),
        gte(activities.startDate, since),
      ),
    );
  const { bests } = await ensureBestEfforts(rows);
  return rows.flatMap((row) =>
    (bests.get(row.id)?.run ?? []).map((best) => ({
      activityId: row.id,
      name: row.name,
      start: row.startDate.toISOString(),
      metres: best.metres,
      seconds: best.seconds,
    })),
  );
}

export async function trainingPacesFor(userId: string, now = new Date()): Promise<TrainingPaces> {
  const [efforts, [metrics]] = await Promise.all([
    recentRunEfforts(userId, now),
    db
      .select({ raceResult: athleteMetrics.raceResult })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
  ]);
  return trainingPaces(parseRaceResult(metrics?.raceResult), estimateVdot(efforts));
}

export async function loadTrainingPacesImpl(): Promise<TrainingPaces> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, source: "none", raceResult: null, estimate: null };
  return trainingPacesFor(session.user.id);
}

/** Saves the athlete's race result, or clears it with null so the estimate takes over again. */
export async function saveRaceResultImpl(raceResult: RaceResult | null) {
  const session = await getRequiredSession();
  // A day of slack for athletes ahead of UTC; a result can't come from further in the future.
  const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (raceResult && raceResult.date > latest) {
    throw new Error("A race result can't be in the future.");
  }
  const updatedAt = new Date();
  await db
    .insert(athleteMetrics)
    .values({ userId: session.user.id, raceResult, updatedAt })
    .onConflictDoUpdate({ target: athleteMetrics.userId, set: { raceResult, updatedAt } });
  return trainingPacesFor(session.user.id);
}
