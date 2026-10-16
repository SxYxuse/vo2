import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, syncRuns } from "@/db/schema.ts";
import {
  DEFAULT_STREAM_KEYS,
  StravaApi,
  type StreamSet,
  type SummaryActivity,
} from "@/integrations/strava/client.ts";
import { StravaDailyLimitError, StravaShortLimitError } from "@/integrations/strava/rate-limit.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getStravaAccessToken } from "@/lib/strava-token.server.ts";
import { buildChartPreview } from "./activity-detail.types.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { DEFAULT_CALENDAR_SETTINGS, mergeCalendarSettings } from "./calendar-settings.types.ts";
import type { CalendarActivity, HomeData, SyncResult } from "./strava-sync.types.ts";
import {
  adaptPlannedWeek,
  getTrainingPlanForUser,
  listPlannedSessions,
} from "./training-plan.server.ts";
import { refreshTrainingLoadsIfNeeded } from "./training-load.server.ts";

const ACTIVITY_PAGE_SIZE = 200;
const STREAM_BATCH_SIZE = 25;
/** Re-pull this many already-stored activities so title/sport edits land after a late Strava change. */
const RECENT_REFRESH_COUNT = 3;

function toCalendarActivity(
  row: {
    id: string;
    name: string;
    sportType: string;
    startDate: Date;
    elapsedTime: number;
    movingTime: number;
    distance: number | null;
    hasHeartrate: boolean;
  },
  hasStreams: boolean,
): CalendarActivity {
  return {
    id: row.id,
    title: row.name,
    start: row.startDate.toISOString(),
    end: new Date(row.startDate.getTime() + row.elapsedTime * 1000).toISOString(),
    sportType: row.sportType,
    distance: row.distance,
    movingTime: row.movingTime,
    hasStreams,
    hasHeartrate: row.hasHeartrate,
  };
}

export async function loadHomeDataImpl(): Promise<HomeData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("home.anonymous");
    return {
      signedIn: false,
      activities: [],
      settings: DEFAULT_CALENDAR_SETTINGS,
      training: null,
      plannedSessions: [],
    };
  }

  const plannedFrom = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const [rows, storedSettings, training, planned, streamedWithoutFlag] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        elapsedTime: activities.elapsedTime,
        movingTime: activities.movingTime,
        distance: activities.distance,
        streamsSyncedAt: activities.streamsSyncedAt,
        hasHeartrate: activities.hasHeartrate,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id))
      .orderBy(activities.startDate),
    getCalendarSettingsForUser(session.user.id),
    getTrainingPlanForUser(session.user.id),
    listPlannedSessions(session.user.id, plannedFrom),
    db
      .select({ activityId: activityStreams.activityId })
      .from(activities)
      .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(and(eq(activities.userId, session.user.id), isNull(activities.streamsSyncedAt))),
  ]);

  const hasStoredStreams = new Set(streamedWithoutFlag.map((row) => row.activityId));
  const calendarActivities: CalendarActivity[] = [];
  let streamsPending = 0;
  for (const row of rows) {
    const hasStreams = Boolean(row.streamsSyncedAt) || hasStoredStreams.has(row.id);
    if (!hasStreams) streamsPending += 1;
    calendarActivities.push(toCalendarActivity(row, hasStreams));
  }

  logger.debug("home.loaded", {
    activityCount: calendarActivities.length,
    streamsPending,
    plannedCount: planned.length,
  });

  return {
    signedIn: true,
    activities: calendarActivities,
    training,
    plannedSessions: planned,
    settings: mergeCalendarSettings(
      storedSettings,
      rows.map((row) => row.sportType),
    ),
  };
}

export async function syncStravaImpl(): Promise<SyncResult> {
  const session = await getRequiredSession();
  logger.info("sync.start");
  const [, accessToken] = await Promise.all([
    stampStoredStreams(session.user.id),
    getStravaAccessToken(session.user.id),
  ]);
  const api = new StravaApi(accessToken);
  let activitiesUpserted = 0;
  let streamsFetched = 0;
  let lastError: string | null = null;
  let pausedUntil: Date | null = null;

  try {
    activitiesUpserted = await upsertAllActivities(api, session.user.id, String(session.user.id));
    streamsFetched = await syncPendingStreams(api, session.user.id);
  } catch (error) {
    if (error instanceof StravaDailyLimitError) {
      pausedUntil = startOfNextUtcDay();
      lastError = error.message;
      logger.warn("sync.daily_limit", { pausedUntil: pausedUntil.toISOString() });
    } else if (error instanceof StravaShortLimitError) {
      pausedUntil = new Date(api.rateLimit.snapshot().nextWindowAt);
      lastError = error.message;
      logger.warn("sync.short_limit", { pausedUntil: pausedUntil.toISOString() });
    } else {
      lastError = error instanceof Error ? error.message : "Sync failed";
      logger.error("sync.failed", errorFields(error));
    }
  }

  await refreshTrainingLoadsIfNeeded(session.user.id);
  if (activitiesUpserted > 0) {
    try {
      await adaptPlannedWeek(session.user.id);
    } catch (error) {
      logger.warn("sync.adapt_week_failed", errorFields(error));
    }
  }

  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)` })
    .from(activities)
    .where(and(eq(activities.userId, session.user.id), isNull(activities.streamsSyncedAt)));
  const streamsPending = Number(pending ?? 0);
  const snapshot = api.rateLimit.snapshot();
  const done = streamsPending === 0 && !pausedUntil;
  if (!pausedUntil && snapshot.shortRemaining <= 5 && streamsPending > 0) {
    pausedUntil = new Date(snapshot.nextWindowAt);
  }

  const status = pausedUntil ? "paused" : "idle";
  await db
    .insert(syncRuns)
    .values({
      userId: session.user.id,
      status,
      activitiesUpserted,
      streamsFetched,
      streamsPending,
      shortLimitRemaining: snapshot.shortRemaining,
      dailyLimitRemaining: snapshot.dailyRemaining,
      pausedUntil,
      lastError,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: syncRuns.userId,
      set: {
        status,
        activitiesUpserted,
        streamsFetched,
        streamsPending,
        shortLimitRemaining: snapshot.shortRemaining,
        dailyLimitRemaining: snapshot.dailyRemaining,
        pausedUntil,
        lastError,
        updatedAt: new Date(),
      },
    });

  if (lastError && !pausedUntil) {
    throw new Error(lastError);
  }

  logger.info("sync.end", {
    activitiesUpserted,
    streamsFetched,
    streamsPending,
    done,
    pausedUntil: pausedUntil?.toISOString() ?? null,
    lastError,
    shortRemaining: snapshot.shortRemaining,
    dailyRemaining: snapshot.dailyRemaining,
  });

  return {
    activitiesUpserted,
    streamsFetched,
    streamsPending,
    done,
    pausedUntil: pausedUntil?.toISOString() ?? null,
    lastError,
    rateLimit: {
      shortRemaining: snapshot.shortRemaining,
      dailyRemaining: snapshot.dailyRemaining,
      nextWindowAt: snapshot.nextWindowAt,
    },
  };
}

async function activityListAfter(userId: string) {
  const rows = await db
    .select({ startDate: activities.startDate })
    .from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(desc(activities.startDate))
    .limit(RECENT_REFRESH_COUNT);
  const oldestLookback = rows.at(-1);
  if (!oldestLookback) return undefined;
  // `after` is exclusive. Step back one second so the lookback activities themselves return
  // alongside anything newer — late title or sport-type edits on Strava then upsert.
  return Math.floor(oldestLookback.startDate.getTime() / 1000) - 1;
}

async function upsertAllActivities(api: StravaApi, userId: string, fallbackAthleteId: string) {
  const after = await activityListAfter(userId);
  let page = 1;
  let upserted = 0;
  while (true) {
    const pageItems = await api.listAthleteActivities({
      page,
      perPage: ACTIVITY_PAGE_SIZE,
      after,
    });
    if (pageItems.length === 0) break;
    logger.debug("sync.activities_page", { page, count: pageItems.length, after: after ?? null });
    const rows = pageItems.flatMap((activity) => {
      const row = activityInsertRow(userId, activity, fallbackAthleteId);
      return row ? [row] : [];
    });
    if (rows.length > 0) {
      await db
        .insert(activities)
        .values(rows)
        .onConflictDoUpdate({
          target: activities.id,
          set: {
            name: sql`excluded.name`,
            sportType: sql`excluded.sport_type`,
            startDate: sql`excluded.start_date`,
            elapsedTime: sql`excluded.elapsed_time`,
            movingTime: sql`excluded.moving_time`,
            distance: sql`excluded.distance`,
            totalElevationGain: sql`excluded.total_elevation_gain`,
            timezone: sql`excluded.timezone`,
            summaryPolyline: sql`excluded.summary_polyline`,
            raw: sql`excluded.raw`,
            averageHeartrate: sql`excluded.average_heartrate`,
            maxHeartrate: sql`excluded.max_heartrate`,
            averageWatts: sql`excluded.average_watts`,
            weightedAverageWatts: sql`excluded.weighted_average_watts`,
            deviceWatts: sql`excluded.device_watts`,
            manual: sql`excluded.manual`,
            trainingLoad: sql`null`,
            loadSource: sql`null`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      upserted += rows.length;
    }
    if (pageItems.length < ACTIVITY_PAGE_SIZE) break;
    page += 1;
  }
  return upserted;
}

function activityInsertRow(userId: string, activity: SummaryActivity, fallbackAthleteId: string) {
  if (activity.id == null || !activity.start_date) return null;
  const metrics = metricsFromSummary(activity);
  return {
    id: String(activity.id),
    userId,
    athleteId: String(activity.athlete?.id ?? fallbackAthleteId),
    name: activity.name ?? "Untitled activity",
    sportType: String(activity.sport_type ?? activity.type ?? "Workout"),
    startDate: new Date(activity.start_date),
    elapsedTime: activity.elapsed_time ?? 0,
    movingTime: activity.moving_time ?? 0,
    distance: activity.distance ?? null,
    totalElevationGain: activity.total_elevation_gain ?? null,
    timezone: activity.timezone ?? null,
    summaryPolyline: activity.map?.summary_polyline ?? null,
    raw: activity,
    streamsSyncedAt: activity.manual ? new Date() : null,
    manual: activity.manual === true,
    ...metrics,
    trainingLoad: null,
    loadSource: null,
    updatedAt: new Date(),
  };
}

type SummaryMetrics = {
  average_heartrate?: number;
  max_heartrate?: number;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricsFromSummary(activity: SummaryActivity) {
  const extra = activity as SummaryActivity & SummaryMetrics;
  return {
    averageHeartrate: finiteNumber(extra.average_heartrate),
    maxHeartrate: finiteNumber(extra.max_heartrate),
    averageWatts: finiteNumber(activity.average_watts),
    weightedAverageWatts: finiteNumber(activity.weighted_average_watts),
    deviceWatts: activity.device_watts === true,
  };
}

async function syncPendingStreams(api: StravaApi, userId: string) {
  const pending = await db
    .select({ id: activities.id, manual: activities.manual })
    .from(activities)
    .where(and(eq(activities.userId, userId), isNull(activities.streamsSyncedAt)))
    .orderBy(desc(activities.startDate))
    .limit(STREAM_BATCH_SIZE);

  logger.debug("sync.streams_batch", { pending: pending.length });
  let fetched = 0;
  for (const row of pending) {
    if (api.rateLimit.shortRemaining <= 5) break;
    const streams = row.manual ? {} : await api.getActivityStreams(row.id, DEFAULT_STREAM_KEYS);
    await storeStreams(row.id, streams);
    fetched += 1;
  }
  return fetched;
}

function hasHeartrateSamples(values: number[] | null | undefined) {
  return Boolean(values?.some((value) => value > 0));
}

async function storeStreams(activityId: string, streams: StreamSet) {
  const now = new Date();
  const latlng = (streams.latlng?.data ?? null) as number[][] | null;
  const hasHeartrate = hasHeartrateSamples(streams.heartrate?.data);
  const chartPreview = buildChartPreview({
    time: streams.time?.data ?? null,
    heartrate: streams.heartrate?.data ?? null,
    watts: streams.watts?.data ?? null,
    cadence: streams.cadence?.data ?? null,
    velocitySmooth: streams.velocity_smooth?.data ?? null,
    altitude: streams.altitude?.data ?? null,
  });
  await db
    .insert(activityStreams)
    .values({
      activityId,
      time: streams.time?.data ?? null,
      latlng,
      distance: streams.distance?.data ?? null,
      altitude: streams.altitude?.data ?? null,
      velocitySmooth: streams.velocity_smooth?.data ?? null,
      heartrate: streams.heartrate?.data ?? null,
      cadence: streams.cadence?.data ?? null,
      watts: streams.watts?.data ?? null,
      temp: streams.temp?.data ?? null,
      moving: streams.moving?.data ?? null,
      gradeSmooth: streams.grade_smooth?.data ?? null,
      chartPreview,
      raw: streams,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: activityStreams.activityId,
      set: {
        time: streams.time?.data ?? null,
        latlng,
        distance: streams.distance?.data ?? null,
        altitude: streams.altitude?.data ?? null,
        velocitySmooth: streams.velocity_smooth?.data ?? null,
        heartrate: streams.heartrate?.data ?? null,
        cadence: streams.cadence?.data ?? null,
        watts: streams.watts?.data ?? null,
        temp: streams.temp?.data ?? null,
        moving: streams.moving?.data ?? null,
        gradeSmooth: streams.grade_smooth?.data ?? null,
        chartPreview,
        raw: streams,
        syncedAt: now,
      },
    });
  await db
    .update(activities)
    .set({ streamsSyncedAt: now, hasHeartrate, updatedAt: now })
    .where(eq(activities.id, activityId));
}

function startOfNextUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

async function stampStoredStreams(userId: string) {
  await db.execute(sql`
    UPDATE activities AS a
    SET streams_synced_at = s.synced_at
    FROM activity_streams AS s
    WHERE a.id = s.activity_id
      AND a.user_id = ${userId}
      AND a.streams_synced_at IS NULL
  `);
}
