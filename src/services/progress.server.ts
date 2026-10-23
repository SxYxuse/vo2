import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { isSportTypeShown } from "./athlete-settings.types.ts";
import { ensureBestEfforts } from "./best-efforts.server.ts";
import type { BestEfforts } from "./best-efforts.ts";
import { toEfficiencyPoint, type EfficiencyPoint } from "./heart-insights.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import {
  BEST_YEAR_DAYS,
  compareEfficiency,
  comparePowerBests,
  compareRunBests,
  PROGRESS_POWER_DURATIONS,
  PROGRESS_RUN_DISTANCES,
  type ProgressData,
  type ProgressSport,
} from "./progress.ts";
import { isPowerCyclingSport } from "./training-load.ts";

/** Power-meter rides and road runs; every other sport is left out (see `ProgressSport`). */
function progressSport(row: { sportType: string; deviceWatts: boolean }): ProgressSport | null {
  if (isPowerCyclingSport(row.sportType) && row.deviceWatts) return "cycling";
  if (row.sportType === "Run") return "running";
  return null;
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
  const { bests, built } = await ensureBestEfforts(shown);

  const sports = (["cycling", "running"] as const).flatMap((sport) => {
    const members = shown.filter((row) => row.sport === sport);
    if (!members.length) return [];
    const efficiency: EfficiencyPoint[] = [];
    const efforts: { start: string; cached: BestEfforts }[] = [];
    for (const row of members) {
      const start = row.startDate.toISOString();
      const point = toEfficiencyPoint({ ...row, start }, lthr[sport]);
      if (point) efficiency.push(point);
      const cached = bests.get(row.id);
      if (cached) efforts.push({ start, cached });
    }
    return [
      {
        sport,
        efficiency: compareEfficiency(efficiency, now),
        bests:
          sport === "cycling"
            ? comparePowerBests(
                efforts.map(({ start, cached }) => ({ start, bests: cached.power })),
                PROGRESS_POWER_DURATIONS,
                now,
              )
            : compareRunBests(
                efforts.map(({ start, cached }) => ({ start, bests: cached.run })),
                PROGRESS_RUN_DISTANCES,
                now,
              ),
      },
    ];
  });

  logger.debug("progress.loaded", {
    activityCount: shown.length,
    bestEffortsBuilt: built,
  });
  return { signedIn: true, sports };
}
