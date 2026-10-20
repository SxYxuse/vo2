import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getProfileSettingsForUser } from "./app-settings.server.ts";
import { buildRideAnalysis, isRideAnalysis, type RideAnalysis } from "./ride-analysis.ts";
import { routeSportGroup, type HistoryActivity, type PredictionInput } from "./route-prediction.ts";
import { SPORT_GROUPS } from "./sport-groups.ts";
import { buildPmc, pmcWithCurrentForm, toFitnessLoad, type PmcPoint } from "./training-load.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";

const HISTORY_DAYS = 365;
/** Enough for a year of regular training in one sport without reading every stream. */
const MAX_HISTORY = 150;

function ctlOn(points: PmcPoint[], at: Date) {
  let ctl: number | null = null;
  for (const point of points) {
    if (point.t > at.getTime()) break;
    ctl = point.ctl;
  }
  return ctl;
}

/**
 * Builds grade-band speeds for activities that don't have them cached yet. Rides keep the
 * result in the same cache the activity detail fills; other sports compute it in memory, since
 * the detail view never shows a terrain table for them.
 */
async function bandsFor(rows: { id: string; cycling: boolean; cached: unknown }[]) {
  const result = new Map<string, RideAnalysis>();
  const missing: string[] = [];
  for (const row of rows) {
    if (isRideAnalysis(row.cached)) result.set(row.id, row.cached);
    else missing.push(row.id);
  }
  if (missing.length === 0) return result;

  const streams = await db
    .select({
      activityId: activityStreams.activityId,
      time: activityStreams.time,
      distance: activityStreams.distance,
      altitude: activityStreams.altitude,
      gradeSmooth: activityStreams.gradeSmooth,
      watts: activityStreams.watts,
      cadence: activityStreams.cadence,
      velocitySmooth: activityStreams.velocitySmooth,
      heartrate: activityStreams.heartrate,
      moving: activityStreams.moving,
    })
    .from(activityStreams)
    .where(inArray(activityStreams.activityId, missing));
  const cycling = new Set(rows.filter((row) => row.cycling).map((row) => row.id));
  for (const stream of streams) {
    const analysis = buildRideAnalysis(stream);
    result.set(stream.activityId, analysis);
    if (cycling.has(stream.activityId)) {
      await db
        .update(activityStreams)
        .set({ rideAnalysis: analysis })
        .where(eq(activityStreams.activityId, stream.activityId));
    }
  }
  logger.debug("route_prediction.bands_built", { count: streams.length });
  return result;
}

/** The athlete's history, form and weight a route prediction reads. */
export async function loadPredictionContext(
  userId: string,
  sportType: string,
  now = new Date(),
): Promise<Omit<PredictionInput, "profile" | "sportType" | "similar">> {
  const group = routeSportGroup(sportType);
  const members = SPORT_GROUPS.find((item) => item.id === group)?.members ?? [];
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);

  const [rows, loadRows, profile, training] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        elapsedTime: activities.elapsedTime,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        rideAnalysis: activityStreams.rideAnalysis,
      })
      .from(activities)
      .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(
        and(
          eq(activities.userId, userId),
          inArray(activities.sportType, [...members]),
          gte(activities.startDate, since),
          eq(activities.manual, false),
        ),
      )
      .orderBy(desc(activities.startDate))
      .limit(MAX_HISTORY),
    db
      .select({
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        trainingLoad: activities.trainingLoad,
        loadSource: activities.loadSource,
      })
      .from(activities)
      .where(eq(activities.userId, userId)),
    getProfileSettingsForUser(userId),
    getTrainingPlanForUser(userId),
  ]);

  const bands = await bandsFor(
    rows.map((row) => ({
      id: row.id,
      cycling: group === "cycling",
      cached: row.rideAnalysis,
    })),
  );
  const timeZone = training?.timeZone || "UTC";
  const pmc = pmcWithCurrentForm(
    buildPmc(
      loadRows.map((row) =>
        toFitnessLoad(
          row.startDate,
          row.trainingLoad ?? 0,
          row.loadSource ?? "duration",
          row.movingTime,
        ),
      ),
      timeZone,
    ),
  );
  const latest = pmc.at(-1);

  const history: HistoryActivity[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    sportType: row.sportType,
    startDate: row.startDate.toISOString(),
    movingSec: row.movingTime,
    elapsedSec: row.elapsedTime,
    distanceM: row.distance ?? 0,
    gainM: row.totalElevationGain ?? 0,
    bands: bands.get(row.id)?.bands ?? [],
    ctl: ctlOn(pmc, row.startDate),
  }));

  return {
    history,
    now,
    form: { ctl: latest?.ctl ?? null, tsb: latest?.tsb ?? null },
    bodyWeightKg: profile.weightKg,
  };
}
