import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { isSportTypeShown } from "./athlete-settings.types.ts";
import {
  POWER_DURATIONS,
  RUN_DISTANCES,
  buildBestEfforts,
  isBestEfforts,
  type BestEfforts,
} from "./best-efforts.ts";
import { toEfficiencyPoint, type EfficiencyPoint } from "./heart-insights.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import {
  BEST_YEAR_DAYS,
  compareEfficiency,
  comparePowerBests,
  compareRunBests,
  type ProgressData,
  type ProgressSport,
} from "./progress.ts";
import { isPowerCyclingSport } from "./training-load.ts";

const STREAM_BATCH = 40;

/** Power-meter rides and road runs; every other sport is left out (see `ProgressSport`). */
function progressSport(row: { sportType: string; deviceWatts: boolean }): ProgressSport | null {
  if (isPowerCyclingSport(row.sportType) && row.deviceWatts) return "cycling";
  if (row.sportType === "Run") return "running";
  return null;
}

/** Builds and stores the best efforts of activities whose cache is missing or outdated. */
async function fillBestEfforts(missing: { id: string; sport: ProgressSport }[]) {
  const built = new Map<string, BestEfforts>();
  const sportById = new Map(missing.map((row) => [row.id, row.sport]));
  for (let index = 0; index < missing.length; index += STREAM_BATCH) {
    const ids = missing.slice(index, index + STREAM_BATCH).map((row) => row.id);
    const streams = await db
      .select({
        activityId: activityStreams.activityId,
        watts: activityStreams.watts,
        distance: activityStreams.distance,
        time: activityStreams.time,
      })
      .from(activityStreams)
      .where(inArray(activityStreams.activityId, ids));
    await Promise.all(
      streams.map((stream) => {
        const sport = sportById.get(stream.activityId);
        const bests = buildBestEfforts({
          ...stream,
          power: sport === "cycling",
          run: sport === "running",
        });
        built.set(stream.activityId, bests);
        return db
          .update(activityStreams)
          .set({ bestEfforts: bests })
          .where(eq(activityStreams.activityId, stream.activityId));
      }),
    );
  }
  return built;
}

export async function loadProgressImpl(now = new Date()): Promise<ProgressData> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, sports: [] };
  const userId = session.user.id;
  const since = new Date(now.getTime() - BEST_YEAR_DAYS * 86_400_000);

  const [rows, settings, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        sportType: activities.sportType,
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        averageHeartrate: activities.averageHeartrate,
        averageWatts: activities.averageWatts,
        weightedAverageWatts: activities.weightedAverageWatts,
        deviceWatts: activities.deviceWatts,
        streamId: activityStreams.activityId,
        bestEfforts: activityStreams.bestEfforts,
      })
      .from(activities)
      .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(and(eq(activities.userId, userId), gte(activities.startDate, since)))
      .orderBy(activities.startDate),
    getAthleteSettings(userId),
    db
      .select(HEART_RATE_METRICS)
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
  ]);

  const athlete = athleteHeartRateFrom(metricsRows[0]);
  const lthr = {
    cycling: athlete.settings?.sports.cycling.lthr ?? athlete.lthr.cycling ?? null,
    running: athlete.settings?.sports.running.lthr ?? athlete.lthr.running ?? null,
  } satisfies Record<ProgressSport, number | null>;

  const shown = rows.flatMap((row) => {
    const sport = progressSport(row);
    return sport && isSportTypeShown(settings.sportTypes, row.sportType) ? [{ ...row, sport }] : [];
  });
  const missing = shown.filter((row) => row.streamId && !isBestEfforts(row.bestEfforts));
  const built = missing.length ? await fillBestEfforts(missing) : new Map<string, BestEfforts>();

  const sports = (["cycling", "running"] as const).flatMap((sport) => {
    const members = shown.filter((row) => row.sport === sport);
    if (!members.length) return [];
    const efficiency: EfficiencyPoint[] = [];
    const efforts: { start: string; cached: BestEfforts }[] = [];
    for (const row of members) {
      const start = row.startDate.toISOString();
      const point = toEfficiencyPoint({ ...row, start }, lthr[sport]);
      if (point) efficiency.push(point);
      const cached = built.get(row.id) ?? row.bestEfforts;
      if (isBestEfforts(cached)) efforts.push({ start, cached });
    }
    return [
      {
        sport,
        efficiency: compareEfficiency(efficiency, now),
        bests:
          sport === "cycling"
            ? comparePowerBests(
                efforts.map(({ start, cached }) => ({ start, bests: cached.power })),
                POWER_DURATIONS,
                now,
              )
            : compareRunBests(
                efforts.map(({ start, cached }) => ({ start, bests: cached.run })),
                RUN_DISTANCES,
                now,
              ),
      },
    ];
  });

  logger.debug("progress.loaded", {
    activityCount: shown.length,
    bestEffortsBuilt: built.size,
  });
  return { signedIn: true, sports };
}
