import { and, eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import {
  buildChartPreview,
  type ActivityChartPreview,
  type ActivityDetail,
} from "./activity-detail.types.ts";
import {
  buildRideAnalysis,
  isRideAnalysis,
  summarizeRide,
  type RideAnalysis,
} from "./ride-analysis.ts";
import { isCyclingSport } from "./training-load.ts";

function isChartPreview(value: unknown): value is ActivityChartPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as ActivityChartPreview;
  return Array.isArray(preview.series) && Array.isArray(preview.chart) && preview.kpis != null;
}

export async function getActivityDetailImpl(id: string): Promise<ActivityDetail | null> {
  const session = await getRequiredSession();
  const [row] = await db
    .select({
      id: activities.id,
      name: activities.name,
      sportType: activities.sportType,
      startDate: activities.startDate,
      elapsedTime: activities.elapsedTime,
      movingTime: activities.movingTime,
      distance: activities.distance,
      totalElevationGain: activities.totalElevationGain,
      streamsSyncedAt: activities.streamsSyncedAt,
      averageWatts: activities.averageWatts,
      weightedAverageWatts: activities.weightedAverageWatts,
      deviceWatts: activities.deviceWatts,
      chartPreview: activityStreams.chartPreview,
      rideAnalysis: activityStreams.rideAnalysis,
      ftp: athleteMetrics.ftp,
    })
    .from(activities)
    .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .leftJoin(athleteMetrics, eq(athleteMetrics.userId, activities.userId))
    .where(and(eq(activities.id, id), eq(activities.userId, session.user.id)))
    .limit(1);

  if (!row) {
    logger.warn("activity_detail.not_found", { activityId: id });
    return null;
  }

  const hasStreamsRow = Boolean(row.streamsSyncedAt);
  const cycling = isCyclingSport(row.sportType);
  const cached = {
    preview: isChartPreview(row.chartPreview) ? row.chartPreview : null,
    ride: isRideAnalysis(row.rideAnalysis) ? row.rideAnalysis : null,
  };
  const derived =
    cached.preview && (cached.ride || !cycling || !hasStreamsRow)
      ? cached
      : await loadAndStoreDerived(id, hasStreamsRow, {
          preview: cached.preview,
          ride: cycling ? cached.ride : null,
          wantRide: cycling,
        });
  const preview = derived.preview ?? emptyPreview();
  logger.debug("activity_detail.loaded", {
    activityId: id,
    hasStreams: hasStreamsRow,
  });

  return {
    id: row.id,
    title: row.name,
    sportType: row.sportType,
    start: row.startDate.toISOString(),
    movingTime: row.movingTime,
    elapsedTime: row.elapsedTime,
    distance: row.distance,
    totalElevationGain: row.totalElevationGain,
    hasStreams: hasStreamsRow && preview.series.length > 0,
    kpis: {
      ...preview.kpis,
      normalizedWatts: cycling
        ? (row.weightedAverageWatts ?? preview.kpis.normalizedWatts ?? null)
        : null,
    },
    series: preview.series,
    chart: preview.chart,
    ride:
      cycling && derived.ride
        ? summarizeRide(derived.ride, {
            sportType: row.sportType,
            movingTime: row.movingTime,
            averageWatts: row.averageWatts,
            normalizedWatts: row.weightedAverageWatts,
            deviceWatts: row.deviceWatts,
            ftp: row.ftp ?? null,
          })
        : null,
  };
}

/** Builds whichever of the chart preview and ride analysis is not cached yet, from one stream read. */
async function loadAndStoreDerived(
  activityId: string,
  hasStreamsRow: boolean,
  cached: { preview: ActivityChartPreview | null; ride: RideAnalysis | null; wantRide: boolean },
): Promise<{ preview: ActivityChartPreview | null; ride: RideAnalysis | null }> {
  if (!hasStreamsRow) {
    return { preview: cached.preview, ride: null };
  }

  const [streams] = await db
    .select({
      time: activityStreams.time,
      distance: activityStreams.distance,
      altitude: activityStreams.altitude,
      gradeSmooth: activityStreams.gradeSmooth,
      heartrate: activityStreams.heartrate,
      watts: activityStreams.watts,
      cadence: activityStreams.cadence,
      velocitySmooth: activityStreams.velocitySmooth,
      moving: activityStreams.moving,
    })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .limit(1);

  if (!streams) {
    return { preview: cached.preview, ride: null };
  }

  const preview =
    cached.preview ??
    buildChartPreview({
      time: streams.time,
      heartrate: streams.heartrate,
      watts: streams.watts,
      cadence: streams.cadence,
      velocitySmooth: streams.velocitySmooth,
      altitude: streams.altitude,
    });
  const ride = cached.ride ?? (cached.wantRide ? buildRideAnalysis(streams) : null);

  logger.debug("activity_detail.derived_built", {
    activityId,
    preview: !cached.preview,
    ride: Boolean(ride && !cached.ride),
  });
  await db
    .update(activityStreams)
    .set({
      ...(cached.preview ? {} : { chartPreview: preview }),
      ...(ride && !cached.ride ? { rideAnalysis: ride } : {}),
    })
    .where(eq(activityStreams.activityId, activityId));

  return { preview, ride };
}

function emptyPreview(): ActivityChartPreview {
  return {
    series: [],
    chart: [],
    kpis: {
      avgHeartrate: null,
      maxHeartrate: null,
      avgWatts: null,
      normalizedWatts: null,
      maxWatts: null,
      avgCadence: null,
      avgSpeed: null,
    },
  };
}
