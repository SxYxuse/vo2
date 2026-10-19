import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { mergeCalendarSettings } from "./calendar-settings.types.ts";
import {
  ALL_SPORTS,
  addHeartrateSamples,
  collapseSportBuckets,
  createSportBucket,
  noteActivityPeak,
  overallFromSports,
  type HeartRateData,
  type HeartRateSport,
  type SportLthrAnchors,
} from "./heart-rate.ts";
const STREAM_BATCH = 40;

const EMPTY_OVERALL: HeartRateSport = {
  sportType: ALL_SPORTS,
  members: [],
  family: null,
  zoneModel: "Each sport uses its own zone model",
  maxHeartrate: null,
  lthr: null,
  lthrSource: null,
  activityCount: 0,
  sampleSeconds: 0,
  peakActivityName: null,
  peakActivityStart: null,
  zones: [],
};

export async function loadHeartRateImpl(): Promise<HeartRateData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("heart_rate.anonymous");
    return { signedIn: false, overall: EMPTY_OVERALL, sports: [], sportTypes: {} };
  }

  const [rows, storedSettings, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        maxHeartrate: activities.maxHeartrate,
        hasHeartrate: activities.hasHeartrate,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id)),
    getCalendarSettingsForUser(session.user.id),
    db
      .select({
        cyclingLthr: athleteMetrics.cyclingLthr,
        runLthr: athleteMetrics.runLthr,
        swimLthr: athleteMetrics.swimLthr,
        lthr: athleteMetrics.lthr,
      })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, session.user.id))
      .limit(1),
  ]);

  const bySport = new Map<string, ReturnType<typeof createSportBucket>>();
  const streamIds: string[] = [];

  for (const row of rows) {
    if (!row.hasHeartrate && row.maxHeartrate == null) continue;
    const start = row.startDate.toISOString();
    const peak = { maxHeartrate: row.maxHeartrate, name: row.name, start };
    const sport = bySport.get(row.sportType) ?? createSportBucket(row.sportType);
    noteActivityPeak(sport, peak);
    bySport.set(row.sportType, sport);
    if (row.hasHeartrate) streamIds.push(row.id);
  }

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
      const sport = bySport.get(sportType);
      if (!sport) continue;
      addHeartrateSamples(sport.histogram, stream.heartrate, stream.time);
    }
  }

  const settings = mergeCalendarSettings(
    storedSettings,
    rows.map((row) => row.sportType),
  );
  const metrics = metricsRows[0];
  const lthrAnchors: SportLthrAnchors = {};
  const cyclingLthr = metrics?.cyclingLthr ?? metrics?.lthr ?? null;
  const runLthr = metrics?.runLthr ?? null;
  const swimLthr = metrics?.swimLthr ?? null;
  if (cyclingLthr) {
    lthrAnchors.cycling = {
      bpm: cyclingLthr,
      source: "estimated-from-max",
    };
  }
  if (runLthr) {
    lthrAnchors.running = {
      bpm: runLthr,
      source: "estimated-from-max",
    };
  }
  if (swimLthr) {
    lthrAnchors.swimming = {
      bpm: swimLthr,
      source: "estimated-from-max",
    };
  }

  const sports = collapseSportBuckets(
    bySport,
    settings.sportGroupShares,
    (sportType) => settings.sportTypes[sportType]?.visible !== false,
    lthrAnchors,
  );

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
