import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { ageFromBirthDate, isSportTypeShown } from "./athlete-settings.types.ts";
import { efficiencyKindFor, histogramFromStreams, toEfficiencyPoint } from "./heart-insights.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import {
  ALL_SPORTS,
  addSessionToSport,
  collapseSportBuckets,
  createSportBucket,
  noteActivityPeak,
  overallFromSports,
  type HeartRateData,
  type HeartRateSport,
} from "./heart-rate.ts";
const STREAM_BATCH = 40;

/** The `athlete_metrics` columns every view resolves heart-rate zones from. */
export const HEART_RATE_METRICS = {
  heartRate: athleteMetrics.heartRate,
  restHr: athleteMetrics.restHr,
  cyclingLthr: athleteMetrics.cyclingLthr,
  runLthr: athleteMetrics.runLthr,
  swimLthr: athleteMetrics.swimLthr,
  lthr: athleteMetrics.lthr,
};

const EMPTY_OVERALL: HeartRateSport = {
  sportType: ALL_SPORTS,
  members: [],
  family: null,
  zoneModel: "Each sport uses its own zone model",
  zoneMethod: null,
  maxHeartrate: null,
  maxAnchor: null,
  lthr: null,
  lthrSource: null,
  restHr: null,
  customZones: null,
  activityCount: 0,
  sampleSeconds: 0,
  peakActivityName: null,
  peakActivityStart: null,
  zones: [],
  activityStarts: [],
  sessions: [],
  efficiencyKind: null,
  efficiency: [],
};

export async function loadHeartRateImpl(): Promise<HeartRateData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("heart_rate.anonymous");
    return { signedIn: false, overall: EMPTY_OVERALL, sports: [], sportTypes: {} };
  }

  const [rows, settings, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        maxHeartrate: activities.maxHeartrate,
        averageHeartrate: activities.averageHeartrate,
        hasHeartrate: activities.hasHeartrate,
        movingTime: activities.movingTime,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        averageWatts: activities.averageWatts,
        weightedAverageWatts: activities.weightedAverageWatts,
        deviceWatts: activities.deviceWatts,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id)),
    getAthleteSettings(session.user.id),
    db
      .select({ ...HEART_RATE_METRICS, birthDate: athleteMetrics.birthDate })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, session.user.id))
      .limit(1),
  ]);

  const bySport = new Map<string, ReturnType<typeof createSportBucket>>();
  const streamIds: string[] = [];

  for (const row of rows) {
    if (!row.hasHeartrate && row.maxHeartrate == null) continue;
    const start = row.startDate.toISOString();
    const peak = {
      maxHeartrate: row.maxHeartrate,
      averageHeartrate: row.averageHeartrate,
      name: row.name,
      start,
    };
    const sport = bySport.get(row.sportType) ?? createSportBucket(row.sportType);
    noteActivityPeak(sport, peak);
    bySport.set(row.sportType, sport);
    if (row.hasHeartrate) streamIds.push(row.id);
  }

  const metrics = metricsRows[0];
  const sports = collapseSportBuckets(
    bySport,
    settings.sportGroupShares,
    (sportType) => isSportTypeShown(settings.sportTypes, sportType),
    athleteHeartRateFrom(metrics),
    { age: ageFromBirthDate(metrics?.birthDate ?? null) },
  );
  const sportByMember = new Map<string, HeartRateSport>();
  for (const sport of sports) {
    for (const member of sport.members) sportByMember.set(member, sport);
    sport.efficiencyKind = efficiencyKindFor(sport.sportType);
  }

  for (const row of rows) {
    const sport = sportByMember.get(row.sportType);
    if (!sport) continue;
    const point = toEfficiencyPoint({ ...row, start: row.startDate.toISOString() }, sport.lthr);
    if (point) sport.efficiency.push(point);
  }
  for (const sport of sports) {
    sport.efficiency.sort((a, b) => a.start.localeCompare(b.start));
  }

  // Zone bounds come from the anchors above, so streams are classified after collapsing.
  const startById = new Map(rows.map((row) => [row.id, row.startDate.toISOString()]));
  const sportById = new Map(rows.map((row) => [row.id, row.sportType]));
  const chunks: string[][] = [];
  for (let index = 0; index < streamIds.length; index += STREAM_BATCH) {
    chunks.push(streamIds.slice(index, index + STREAM_BATCH));
  }
  const streamBatches = await Promise.all(
    chunks.map((chunk) =>
      db
        .select({
          activityId: activityStreams.activityId,
          heartrate: activityStreams.heartrate,
          time: activityStreams.time,
        })
        .from(activityStreams)
        .where(inArray(activityStreams.activityId, chunk)),
    ),
  );

  for (const streams of streamBatches) {
    for (const stream of streams) {
      const sportType = sportById.get(stream.activityId);
      if (!sportType) continue;
      const sport = sportByMember.get(sportType);
      const start = startById.get(stream.activityId);
      if (!sport || !start) continue;
      addSessionToSport(sport, start, histogramFromStreams(stream.heartrate, stream.time));
    }
  }

  logger.debug("heart_rate.loaded", {
    activityCount: rows.length,
    streamCount: streamIds.length,
    sportCount: sports.length,
  });
  return {
    signedIn: true,
    overall: overallFromSports(sports),
    sports,
    sportTypes: settings.sportTypes,
  };
}
