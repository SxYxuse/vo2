import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics, goals } from "@/db/schema.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { ageFromBirthDate } from "./athlete-settings.types.ts";
import { ensureBestEfforts } from "./best-efforts.server.ts";
import { buildFlatPaces, isFlatPaces, zone2Pace, type FlatPaces } from "./easy-pace.ts";
import { estimateMaxHrAnchor } from "./heart-insights.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import {
  athleteMaxHr,
  emptyHistogram,
  heartRateFamily,
  isPlausibleBpm,
  sportHeartRate,
  zonesFromHistogram,
} from "./heart-rate.ts";
import { sportGroupFor } from "./sport-groups.ts";
import {
  DEFAULT_TARGET_M,
  ESTIMATE_WINDOW_DAYS,
  NO_PACES,
  canPredict,
  effortChoices,
  estimateVdot,
  isRaceResultCurrent,
  parsePaceSettings,
  parseRaceResult,
  trainingPaces,
  type EasyFromHeart,
  type PaceChoice,
  type PaceSettings,
  type RaceResult,
  type RunEffort,
  type TrainingPaces,
} from "./training-paces.types.ts";

/** Zone 2 is read from road runs of the last eight weeks: recent enough to be today's fitness. */
const ZONE_2_WINDOW_DAYS = 8 * 7;
const STREAM_BATCH = 40;

type RoadRun = {
  id: string;
  name: string;
  startDate: Date;
  hasHeartrate: boolean;
  streamId: string | null;
  flatPaces: unknown;
};

/**
 * Every road run with its best efforts. A treadmill run is sport type Run too, but has no route,
 * and its watch distance is often several percent off. Hidden sport types count: hiding changes
 * views, not the athlete's fitness (ADR 0018).
 */
async function roadRuns(userId: string) {
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      sportType: activities.sportType,
      startDate: activities.startDate,
      deviceWatts: activities.deviceWatts,
      hasHeartrate: activities.hasHeartrate,
      streamId: activityStreams.activityId,
      bestEfforts: activityStreams.bestEfforts,
      flatPaces: activityStreams.flatPaces,
    })
    .from(activities)
    .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(
      and(
        eq(activities.userId, userId),
        eq(activities.sportType, "Run"),
        isNotNull(activities.summaryPolyline),
        ne(activities.summaryPolyline, ""),
      ),
    );
  const { bests } = await ensureBestEfforts(rows);
  const efforts: RunEffort[] = rows.flatMap((row) =>
    (bests.get(row.id)?.run ?? []).map((best) => ({
      activityId: row.id,
      name: row.name,
      start: row.startDate.toISOString(),
      metres: best.metres,
      seconds: best.seconds,
    })),
  );
  return { rows, efforts };
}

/** Each run's flat running by heart rate and pace, building and storing the missing ones. */
async function ensureFlatPaces(rows: RoadRun[]): Promise<FlatPaces[]> {
  const result: FlatPaces[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    if (!row.streamId || !row.hasHeartrate) continue;
    if (isFlatPaces(row.flatPaces)) result.push(row.flatPaces);
    else missing.push(row.id);
  }
  for (let index = 0; index < missing.length; index += STREAM_BATCH) {
    const streams = await db
      .select({
        activityId: activityStreams.activityId,
        time: activityStreams.time,
        heartrate: activityStreams.heartrate,
        velocitySmooth: activityStreams.velocitySmooth,
        gradeSmooth: activityStreams.gradeSmooth,
        moving: activityStreams.moving,
      })
      .from(activityStreams)
      .where(inArray(activityStreams.activityId, missing.slice(index, index + STREAM_BATCH)));
    await Promise.all(
      streams.map((stream) => {
        const flatPaces = buildFlatPaces(stream);
        result.push(flatPaces);
        return db
          .update(activityStreams)
          .set({ flatPaces })
          .where(eq(activityStreams.activityId, stream.activityId));
      }),
    );
  }
  return result;
}

type Metrics = Parameters<typeof athleteHeartRateFrom>[0] & { birthDate: string | null };

/** Running zone 2 from the athlete's zone method, resolved as the heart rate page does. */
async function zone2Bounds(userId: string, metrics: Metrics | undefined) {
  const rows = await db
    .select({
      sportType: activities.sportType,
      startDate: activities.startDate,
      maxHeartrate: activities.maxHeartrate,
      averageHeartrate: activities.averageHeartrate,
    })
    .from(activities)
    .where(and(eq(activities.userId, userId), isNotNull(activities.maxHeartrate)));
  const peaks = rows
    .filter(
      (row) => heartRateFamily(row.sportType) === "running" && isPlausibleBpm(row.maxHeartrate),
    )
    .map((row) => ({
      bpm: row.maxHeartrate!,
      start: row.startDate.toISOString(),
      avgBpm: row.averageHeartrate,
    }));
  const athlete = athleteHeartRateFrom(metrics);
  const maxHr = estimateMaxHrAnchor(peaks, {
    family: "running",
    age: ageFromBirthDate(metrics?.birthDate ?? null),
    athleteBpm: athleteMaxHr("running", athlete),
  }).bpm;
  const resolved = sportHeartRate("running", maxHr, athlete);
  const zone = zonesFromHistogram(emptyHistogram(), "Run", resolved)[1];
  return zone?.minBpm != null && zone.maxBpm != null
    ? { minBpm: zone.minBpm, maxBpm: zone.maxBpm }
    : null;
}

/** The distance of the next running A goal, which the estimate aims at. */
async function targetMetres(userId: string, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const rows = await db
    .select({ sportType: goals.sportType, date: goals.date, distanceM: goals.distanceM })
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.priority, "A"), gte(goals.date, today)));
  const [next] = rows
    .filter(
      (goal) =>
        sportGroupFor(goal.sportType)?.id === "running" &&
        goal.distanceM != null &&
        canPredict(goal.distanceM),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return next?.distanceM ?? DEFAULT_TARGET_M;
}

async function readMetrics(userId: string) {
  const [metrics] = await db
    .select({
      ...HEART_RATE_METRICS,
      birthDate: athleteMetrics.birthDate,
      raceResult: athleteMetrics.raceResult,
      paceSettings: athleteMetrics.paceSettings,
    })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  return metrics;
}

export async function trainingPacesFor(userId: string, now = new Date()): Promise<TrainingPaces> {
  const [{ rows, efforts }, metrics, target] = await Promise.all([
    roadRuns(userId),
    readMetrics(userId),
    targetMetres(userId, now),
  ]);
  const windowStart = now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000;
  const recent = efforts.filter((effort) => Date.parse(effort.start) >= windowStart);
  const zone2Start = now.getTime() - ZONE_2_WINDOW_DAYS * 86_400_000;
  const [zone, flat] = await Promise.all([
    zone2Bounds(userId, metrics),
    ensureFlatPaces(rows.filter((row) => row.startDate.getTime() >= zone2Start)),
  ]);
  const heart: EasyFromHeart = zone
    ? { kind: "zone2", ...zone2Pace(flat, zone) }
    : { kind: "zones-missing" };
  return trainingPaces({
    settings: parsePaceSettings(metrics?.paceSettings),
    raceResult: parseRaceResult(metrics?.raceResult),
    estimate: estimateVdot(recent, now, target),
    choices: effortChoices(efforts, now),
    heart,
    now,
  });
}

export async function loadTrainingPacesImpl(): Promise<TrainingPaces> {
  const session = await getOptionalSession();
  if (!session) return NO_PACES;
  return trainingPacesFor(session.user.id);
}

async function storePaceSettings(
  userId: string,
  values: Partial<typeof athleteMetrics.$inferInsert>,
) {
  const updatedAt = new Date();
  await db
    .insert(athleteMetrics)
    .values({ userId, ...values, updatedAt })
    .onConflictDoUpdate({ target: athleteMetrics.userId, set: { ...values, updatedAt } });
}

/**
 * Sets the athlete's race result, which then sets the paces, or clears it with null; clearing
 * the result the paces came from goes back to Automatic.
 */
export async function saveRaceResultImpl(raceResult: RaceResult | null) {
  const session = await getRequiredSession();
  // A day of slack for athletes ahead of UTC; a result can't come from further in the future.
  const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (raceResult && raceResult.date > latest) {
    throw new Error("A race result can't be in the future.");
  }
  // The form's earliest date is the athlete's local day, a day behind UTC for some; allow it.
  const yesterday = new Date(Date.now() - 86_400_000);
  if (raceResult && !isRaceResultCurrent(raceResult, yesterday)) {
    throw new Error("A race result must be from the last 16 weeks.");
  }
  const metrics = await readMetrics(session.user.id);
  const settings = parsePaceSettings(metrics?.paceSettings);
  const from = settings.from ?? (metrics?.raceResult ? "race" : "automatic");
  const paceSettings: PaceSettings = {
    ...settings,
    from: raceResult ? "race" : from === "race" ? "automatic" : from,
  };
  await storePaceSettings(session.user.id, { raceResult, paceSettings });
  return trainingPacesFor(session.user.id);
}

/**
 * Saves one choice: Automatic, a best effort from the athlete's own list (looked up again, so
 * only their own efforts can be picked), or where the easy pace comes from.
 */
export async function savePaceChoiceImpl(choice: PaceChoice) {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const [metrics, current] = await Promise.all([readMetrics(userId), trainingPacesFor(userId)]);
  const settings = parsePaceSettings(metrics?.paceSettings);
  let next: PaceSettings;
  if ("easyFrom" in choice) {
    next = { ...settings, from: current.from, easyFrom: choice.easyFrom };
  } else if (choice.from === "automatic") {
    next = { ...settings, from: "automatic" };
  } else {
    const effort = current.choices
      .filter((option) => option.metres === choice.metres)
      .flatMap((option) => [option.recent, option.allTime])
      .find((option) => option?.activityId === choice.activityId);
    if (!effort) throw new Error("That best effort is no longer in your runs.");
    next = { ...settings, from: "effort", effort };
  }
  await storePaceSettings(userId, { paceSettings: next });
  return trainingPacesFor(userId);
}
