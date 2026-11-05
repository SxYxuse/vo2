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
import { ageFromBirthDate } from "./athlete-settings.types.ts";
import {
  buildHeartAnalysis,
  denseHistogram,
  efficiencyKindFor,
  efficiencyNorm,
  estimateMaxHrAnchor,
  isHeartAnalysis,
  toEfficiencyPoint,
  usualHeartrate,
  type ActivityHeart,
  type EfficiencyPoint,
  type HeartAnalysis,
  type HeartPeak,
} from "./heart-insights.ts";
import {
  athleteMaxHr,
  heartRateFamily,
  histogramSeconds,
  isPlausibleBpm,
  sportHeartRate,
  zoneMethodLabel,
  zonesFromHistogram,
} from "./heart-rate.ts";
import { athleteHeartRateFrom, type HeartRateMetricsRow } from "./heart-rate-settings.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import {
  buildRideAnalysis,
  isRideAnalysis,
  summarizeRide,
  type RideAnalysis,
} from "./ride-analysis.ts";
import { powerFileIdFor } from "./power-file.server.ts";
import { isOtherSportType } from "./sport-groups.ts";
import { isCyclingSport } from "./training-load.ts";

function isChartPreview(value: unknown): value is ActivityChartPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as ActivityChartPreview;
  return Array.isArray(preview.series) && Array.isArray(preview.chart) && preview.kpis != null;
}

type DerivedCache = {
  preview: ActivityChartPreview | null;
  ride: RideAnalysis | null;
  heart: HeartAnalysis | null;
};

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
      summaryPolyline: activities.summaryPolyline,
      averageHeartrate: activities.averageHeartrate,
      estimatedHeartrate: activities.estimatedHeartrate,
      averageWatts: activities.averageWatts,
      weightedAverageWatts: activities.weightedAverageWatts,
      deviceWatts: activities.deviceWatts,
      chartPreview: activityStreams.chartPreview,
      rideAnalysis: activityStreams.rideAnalysis,
      heartAnalysis: activityStreams.heartAnalysis,
      ftp: athleteMetrics.ftp,
      ...HEART_RATE_METRICS,
      birthDate: athleteMetrics.birthDate,
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
  // Other sport types are never shown, so their page is missing like any other (ADR 0029).
  if (isOtherSportType(row.sportType)) return null;

  const hasStreamsRow = Boolean(row.streamsSyncedAt);
  const cycling = isCyclingSport(row.sportType);
  const cached: DerivedCache = {
    preview: isChartPreview(row.chartPreview) ? row.chartPreview : null,
    ride: isRideAnalysis(row.rideAnalysis) ? row.rideAnalysis : null,
    heart: isHeartAnalysis(row.heartAnalysis) ? row.heartAnalysis : null,
  };
  const complete =
    cached.preview && (!hasStreamsRow || ((cached.ride || !cycling) && cached.heart));
  const derived = complete
    ? cached
    : await loadAndStoreDerived(id, hasStreamsRow, {
        ...cached,
        ride: cycling ? cached.ride : null,
        wantRide: cycling,
        context: {
          family: heartRateFamily(row.sportType),
          sportType: row.sportType,
          distance: row.distance,
          totalElevationGain: row.totalElevationGain,
        },
      });
  const preview = derived.preview ?? emptyPreview();
  const heart =
    derived.heart?.histogram.length || isPlausibleBpm(row.averageHeartrate)
      ? await buildActivityHeart(session.user.id, row, derived.heart)
      : null;
  const powerFileId = await powerFileIdFor(session.user.id, row.sportType, row.startDate);
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
    outline: row.summaryPolyline,
    kpis: {
      ...preview.kpis,
      normalizedWatts: cycling
        ? (row.weightedAverageWatts ?? preview.kpis.normalizedWatts ?? null)
        : null,
    },
    estimatedHeartrate: isPlausibleBpm(row.averageHeartrate) ? null : row.estimatedHeartrate,
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
    heart,
    powerFileId,
  };
}

type DetailRow = HeartRateMetricsRow & {
  id: string;
  sportType: string;
  startDate: Date;
  movingTime: number;
  distance: number | null;
  totalElevationGain: number | null;
  averageHeartrate: number | null;
  averageWatts: number | null;
  weightedAverageWatts: number | null;
  deviceWatts: boolean;
  birthDate: string | null;
};

/** Anchors come from the athlete's whole history, the same way the heart rate page builds them. */
async function buildActivityHeart(
  userId: string,
  row: DetailRow,
  analysis: HeartAnalysis | null,
): Promise<ActivityHeart> {
  const family = heartRateFamily(row.sportType);
  const kind = efficiencyKindFor(row.sportType);
  const history = await db
    .select({
      id: activities.id,
      sportType: activities.sportType,
      startDate: activities.startDate,
      movingTime: activities.movingTime,
      distance: activities.distance,
      totalElevationGain: activities.totalElevationGain,
      maxHeartrate: activities.maxHeartrate,
      averageHeartrate: activities.averageHeartrate,
      averageWatts: activities.averageWatts,
      weightedAverageWatts: activities.weightedAverageWatts,
      deviceWatts: activities.deviceWatts,
    })
    .from(activities)
    .where(eq(activities.userId, userId));

  const peaks: HeartPeak[] = [];
  for (const item of history) {
    if (heartRateFamily(item.sportType) !== family || !isPlausibleBpm(item.maxHeartrate)) continue;
    peaks.push({
      bpm: item.maxHeartrate!,
      start: item.startDate.toISOString(),
      avgBpm: item.averageHeartrate,
    });
  }
  const athlete = athleteHeartRateFrom(row);
  const maxAnchor = estimateMaxHrAnchor(peaks, {
    family,
    age: ageFromBirthDate(row.birthDate),
    athleteBpm: athleteMaxHr(family, athlete),
  });
  const resolved = sportHeartRate(family, maxAnchor.bpm, athlete);
  const lthr = resolved.lthr;

  const histogram = analysis?.histogram.length ? denseHistogram(analysis.histogram) : null;
  const zones = histogram ? zonesFromHistogram(histogram, row.sportType, resolved) : null;

  const start = row.startDate.toISOString();
  const current = toEfficiencyPoint({ ...row, start }, lthr);
  let efficiency: ActivityHeart["efficiency"] = null;
  let usual: ActivityHeart["usual"] = null;
  if (current && kind) {
    const points: EfficiencyPoint[] = [];
    for (const item of history) {
      if (item.id === row.id || efficiencyKindFor(item.sportType) !== kind) continue;
      const point = toEfficiencyPoint({ ...item, start: item.startDate.toISOString() }, lthr);
      if (point) points.push(point);
    }
    const norm = efficiencyNorm(points, start);
    efficiency = {
      kind,
      value: current.ef,
      aerobic: current.aerobic,
      norm,
      deltaPct: norm ? Math.round(((current.ef - norm.value) / norm.value) * 1000) / 10 : null,
    };
    const expected = usualHeartrate(points, start, current.output);
    if (expected) {
      usual = {
        expectedBpm: expected.bpm,
        gapBpm: Math.round(current.avgHeartrate - expected.bpm),
        count: expected.count,
      };
    }
  }

  return {
    family,
    zoneModel: zoneMethodLabel(family, resolved.method),
    maxHeartrate: maxAnchor.bpm,
    lthr,
    zones,
    zoneSeconds: histogram ? histogramSeconds(histogram) : 0,
    decoupling: analysis?.decoupling ?? null,
    efficiency,
    usual,
    peaks: analysis?.peaks ?? [],
    avgTempC: analysis?.avgTempC ?? null,
  };
}

/** Builds whichever derived summaries are not cached yet, from one stream read. */
async function loadAndStoreDerived(
  activityId: string,
  hasStreamsRow: boolean,
  cached: DerivedCache & {
    wantRide: boolean;
    context: Parameters<typeof buildHeartAnalysis>[1];
  },
): Promise<DerivedCache> {
  if (!hasStreamsRow) {
    return { preview: cached.preview, ride: null, heart: null };
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
      temp: activityStreams.temp,
    })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .limit(1);

  if (!streams) {
    return { preview: cached.preview, ride: null, heart: null };
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
  const heart = cached.heart ?? buildHeartAnalysis(streams, cached.context);

  logger.debug("activity_detail.derived_built", {
    activityId,
    preview: !cached.preview,
    ride: Boolean(ride && !cached.ride),
    heart: !cached.heart,
  });
  await db
    .update(activityStreams)
    .set({
      ...(cached.preview ? {} : { chartPreview: preview }),
      ...(ride && !cached.ride ? { rideAnalysis: ride } : {}),
      ...(cached.heart ? {} : { heartAnalysis: heart }),
    })
    .where(eq(activityStreams.activityId, activityId));

  return { preview, ride, heart };
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
