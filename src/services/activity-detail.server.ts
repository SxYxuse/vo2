import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { activities, activityStreams } from "#/db/schema.ts";
import { logger } from "#/lib/logger.server.ts";
import { getRequiredSession } from "#/lib/session.server.ts";
import {
  buildChartPreview,
  type ActivityChartPreview,
  type ActivityDetail,
} from "./activity-detail.types.ts";
import { fieldTestForActivity } from "./assessments.server.ts";
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
      weightedAverageWatts: activities.weightedAverageWatts,
      chartPreview: activityStreams.chartPreview,
    })
    .from(activities)
    .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(and(eq(activities.id, id), eq(activities.userId, session.user.id)))
    .limit(1);

  if (!row) {
    logger.warn("activity_detail.not_found", { activityId: id });
    return null;
  }

  const [preview, fieldTest] = await Promise.all([
    isChartPreview(row.chartPreview)
      ? row.chartPreview
      : loadAndStoreChartPreview(id, Boolean(row.streamsSyncedAt)),
    fieldTestForActivity(session.user.id, id),
  ]);
  logger.debug("activity_detail.loaded", {
    activityId: id,
    hasStreams: Boolean(row.streamsSyncedAt),
    hasFieldTest: Boolean(fieldTest),
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
    hasStreams: Boolean(row.streamsSyncedAt) && preview.series.length > 0,
    kpis: {
      ...preview.kpis,
      normalizedWatts: isCyclingSport(row.sportType)
        ? (row.weightedAverageWatts ?? preview.kpis.normalizedWatts ?? null)
        : null,
    },
    series: preview.series,
    chart: preview.chart,
    fieldTest,
  };
}

async function loadAndStoreChartPreview(
  activityId: string,
  hasStreamsRow: boolean,
): Promise<ActivityChartPreview> {
  if (!hasStreamsRow) {
    return { series: [], chart: [], kpis: emptyKpis() };
  }

  const [streams] = await db
    .select({
      time: activityStreams.time,
      heartrate: activityStreams.heartrate,
      watts: activityStreams.watts,
      cadence: activityStreams.cadence,
      velocitySmooth: activityStreams.velocitySmooth,
      altitude: activityStreams.altitude,
    })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .limit(1);

  const preview = buildChartPreview({
    time: streams?.time ?? null,
    heartrate: streams?.heartrate ?? null,
    watts: streams?.watts ?? null,
    cadence: streams?.cadence ?? null,
    velocitySmooth: streams?.velocitySmooth ?? null,
    altitude: streams?.altitude ?? null,
  });

  if (streams) {
    logger.debug("activity_detail.chart_preview_built", { activityId });
    await db
      .update(activityStreams)
      .set({ chartPreview: preview })
      .where(eq(activityStreams.activityId, activityId));
  }

  return preview;
}

function emptyKpis(): ActivityChartPreview["kpis"] {
  return {
    avgHeartrate: null,
    maxHeartrate: null,
    avgWatts: null,
    normalizedWatts: null,
    maxWatts: null,
    avgCadence: null,
    avgSpeed: null,
  };
}
