import { and, eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import {
  buildActivitySamples,
  buildOverview,
  type ActivityAnalysisSnapshot,
} from "./activity-analysis.types.ts";

/** One activity's overview and samples, read by the coach chat's activity tools. */
export async function loadActivityAnalysisSnapshot(activityId: string, userId: string) {
  const [activityRows, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        movingTime: activities.movingTime,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        streamsSyncedAt: activities.streamsSyncedAt,
        time: activityStreams.time,
        distanceStream: activityStreams.distance,
        altitude: activityStreams.altitude,
        gradeSmooth: activityStreams.gradeSmooth,
        heartrate: activityStreams.heartrate,
        watts: activityStreams.watts,
        velocitySmooth: activityStreams.velocitySmooth,
        cadence: activityStreams.cadence,
      })
      .from(activities)
      .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
      .limit(1),
    db
      .select({ ...HEART_RATE_METRICS, ftp: athleteMetrics.ftp })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
  ]);
  const [row] = activityRows;
  if (!row) throw new Error("Activity not found");
  const [metrics] = metricsRows;

  const samples = row.streamsSyncedAt
    ? buildActivitySamples({
        time: row.time,
        distance: row.distanceStream,
        altitude: row.altitude,
        gradeSmooth: row.gradeSmooth,
        heartrate: row.heartrate,
        watts: row.watts,
        velocitySmooth: row.velocitySmooth,
        cadence: row.cadence,
      })
    : [];

  return {
    overview: buildOverview({
      title: row.name,
      sportType: row.sportType,
      movingTime: row.movingTime,
      distance: row.distance,
      totalElevationGain: row.totalElevationGain,
      samples,
      athlete: {
        ftp: metrics?.ftp ?? null,
        heartRate: athleteHeartRateFrom(metrics),
      },
    }),
    samples,
  } satisfies ActivityAnalysisSnapshot;
}
