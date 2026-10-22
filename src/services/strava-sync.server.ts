import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, pool } from "@/db/index.ts";
import { activities, activityStreams, syncRuns } from "@/db/schema.ts";
import { StravaApi, type StreamSet, type SummaryActivity } from "@/integrations/strava/client.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getStravaAccessToken } from "@/lib/strava-token.server.ts";
import { CLEARED_DERIVED_CACHES, staleDerivedCacheIds } from "./activity-derived-cache.ts";
import { buildChartPreview } from "./activity-detail.types.ts";
import { athleteExists } from "./athlete-deletion.server.ts";
import { syncAthlete, type SyncStore } from "./strava-sync-run.ts";
import type { SyncResult, SyncStatus } from "./strava-sync.types.ts";
import { deriveSyncKind, historyCompleteFromRun } from "./strava-sync.types.ts";
import { refreshTrainingLoadsIfNeeded } from "./training-load.server.ts";

export async function loadSyncStatusImpl(): Promise<SyncStatus> {
  const session = await getOptionalSession();
  if (!session) {
    return emptySyncStatus();
  }
  return loadSyncStatusForUser(session.user.id);
}

async function loadSyncStatusForUser(userId: string): Promise<SyncStatus> {
  const [run, counts] = await Promise.all([
    db
      .select({
        status: syncRuns.status,
        pausedUntil: syncRuns.pausedUntil,
        lastError: syncRuns.lastError,
        updatedAt: syncRuns.updatedAt,
        shortLimitRemaining: syncRuns.shortLimitRemaining,
        dailyLimitRemaining: syncRuns.dailyLimitRemaining,
      })
      .from(syncRuns)
      .where(eq(syncRuns.userId, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    activityCopyCounts(userId),
  ]);
  const pausedUntil = run?.pausedUntil?.toISOString() ?? null;
  const historyComplete = historyCompleteFromRun(run?.status ?? null, counts.streamsPending);
  const status = deriveSyncKind({
    hasRun: Boolean(run),
    activityCount: counts.activityCount,
    streamsPending: counts.streamsPending,
    historyComplete,
    pausedUntil,
    lastError: run?.lastError ?? null,
  });
  return {
    activityCount: counts.activityCount,
    streamsPending: counts.streamsPending,
    streamsCopied: Math.max(counts.activityCount - counts.streamsPending, 0),
    status,
    historyComplete,
    pausedUntil,
    lastError: run?.lastError ?? null,
    lastAttemptAt: run?.updatedAt?.toISOString() ?? null,
    shortLimitRemaining: run?.shortLimitRemaining ?? null,
    dailyLimitRemaining: run?.dailyLimitRemaining ?? null,
  };
}

function emptySyncStatus(): SyncStatus {
  return {
    activityCount: 0,
    streamsPending: 0,
    streamsCopied: 0,
    status: "never",
    historyComplete: false,
    pausedUntil: null,
    lastError: null,
    lastAttemptAt: null,
    shortLimitRemaining: null,
    dailyLimitRemaining: null,
  };
}

async function activityCopyCounts(userId: string) {
  const [totals] = await db
    .select({
      activityCount: sql<number>`count(*)`,
      streamsPending: sql<number>`count(*) filter (where ${activities.streamsSyncedAt} is null)`,
    })
    .from(activities)
    .where(eq(activities.userId, userId));
  return {
    activityCount: Number(totals?.activityCount ?? 0),
    streamsPending: Number(totals?.streamsPending ?? 0),
  };
}

export async function syncStravaImpl(): Promise<SyncResult> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  // The stored pause is read inside the lock: a sync that just finished on another device may
  // have set it.
  const result = await withAthleteSyncLock(userId, () =>
    syncAthlete({
      store: postgresSyncStore(userId),
      openStrava: async () => new StravaApi(await getStravaAccessToken(userId)),
    }),
  );
  if (result) return result;
  logger.info("sync.already_running");
  return {
    activitiesUpserted: 0,
    streamsFetched: 0,
    streamsPending: 0,
    historyComplete: false,
    done: false,
    pausedUntil: null,
    lastError: null,
    alreadyRunning: true,
    rateLimit: { shortRemaining: 0, dailyRemaining: 0, nextWindowAt: new Date().toISOString() },
  };
}

function postgresSyncStore(userId: string): SyncStore {
  return {
    readRun: () =>
      db
        .select({
          status: syncRuns.status,
          pausedUntil: syncRuns.pausedUntil,
          lastError: syncRuns.lastError,
          shortLimitRemaining: syncRuns.shortLimitRemaining,
          dailyLimitRemaining: syncRuns.dailyLimitRemaining,
        })
        .from(syncRuns)
        .where(eq(syncRuns.userId, userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    async recordRun(run) {
      const fields = { ...run, updatedAt: new Date() };
      await db
        .insert(syncRuns)
        .values({ userId, ...fields })
        .onConflictDoUpdate({ target: syncRuns.userId, set: fields });
    },
    streamsPending: async () => (await activityCopyCounts(userId)).streamsPending,
    async newestStartDates(limit) {
      const rows = await db
        .select({ startDate: activities.startDate })
        .from(activities)
        .where(eq(activities.userId, userId))
        .orderBy(desc(activities.startDate))
        .limit(limit);
      return rows.map((row) => row.startDate);
    },
    async oldestStartDate() {
      const [row] = await db
        .select({ startDate: activities.startDate })
        .from(activities)
        .where(eq(activities.userId, userId))
        .orderBy(asc(activities.startDate))
        .limit(1);
      return row?.startDate ?? null;
    },
    upsertActivities: (items) => insertActivityRows(userId, items),
    activitiesWithoutStreams: (limit) =>
      db
        .select({ id: activities.id, manual: activities.manual })
        .from(activities)
        .where(and(eq(activities.userId, userId), isNull(activities.streamsSyncedAt)))
        .orderBy(desc(activities.startDate))
        .limit(limit),
    storeStreams,
    stampStoredStreams: () => stampStoredStreams(userId),
    athleteExists: () => athleteExists(userId),
    refreshTrainingLoads: () => refreshTrainingLoadsIfNeeded(userId),
  };
}

/**
 * One sync per athlete across devices, tabs, and server instances. A session-level advisory lock
 * lives on one pooled connection, so Postgres frees it if the server dies mid-sync. Returns null
 * when another request holds it. This needs a direct (or session-pooled) Postgres connection.
 */
async function withAthleteSyncLock<T>(userId: string, run: () => Promise<T>): Promise<T | null> {
  const key = `strava-sync:${userId}`;
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [key],
    );
    if (!rows[0]?.locked) return null;
    try {
      return await run();
    } finally {
      try {
        await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
      } catch (error) {
        // Dropping the connection releases the lock too.
        broken = error instanceof Error ? error : new Error("Advisory unlock failed");
        logger.warn("sync.unlock_failed", errorFields(error));
      }
    }
  } finally {
    client.release(broken);
  }
}

/**
 * Every sync re-reads the newest few activities, so clearing their load unconditionally would
 * recompute the whole history on each call. A cleared load is what triggers the recompute.
 */
const LOAD_INPUTS_CHANGED = sql.raw(`(
  activities.sport_type, activities.start_date, activities.moving_time,
  activities.average_heartrate, activities.max_heartrate, activities.average_watts,
  activities.weighted_average_watts, activities.device_watts
) is distinct from (
  excluded.sport_type, excluded.start_date, excluded.moving_time,
  excluded.average_heartrate, excluded.max_heartrate, excluded.average_watts,
  excluded.weighted_average_watts, excluded.device_watts
)`);

async function insertActivityRows(userId: string, pageItems: SummaryActivity[]) {
  const rows = pageItems.flatMap((activity) => {
    const row = activityInsertRow(userId, activity);
    return row ? [row] : [];
  });
  if (rows.length === 0) return 0;
  const stored = await db
    .select({
      id: activities.id,
      sportType: activities.sportType,
      distance: activities.distance,
      totalElevationGain: activities.totalElevationGain,
    })
    .from(activities)
    .where(
      inArray(
        activities.id,
        rows.map((row) => row.id),
      ),
    );
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
        trainingLoad: sql`case when ${LOAD_INPUTS_CHANGED} then null else activities.training_load end`,
        loadSource: sql`case when ${LOAD_INPUTS_CHANGED} then null else activities.load_source end`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  // after the upsert, so a detail view in between can only rebuild from the fresh fields
  const stale = staleDerivedCacheIds(stored, rows);
  if (stale.length > 0) {
    await db
      .update(activityStreams)
      .set(CLEARED_DERIVED_CACHES)
      .where(inArray(activityStreams.activityId, stale));
  }
  return rows.length - stored.length;
}

function activityInsertRow(userId: string, activity: SummaryActivity) {
  if (activity.id == null || !activity.start_date) return null;
  const metrics = metricsFromSummary(activity);
  return {
    id: String(activity.id),
    userId,
    athleteId: String(activity.athlete?.id ?? userId),
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
        // rebuilt from the fresh streams on the next detail view
        ...CLEARED_DERIVED_CACHES,
        raw: streams,
        syncedAt: now,
      },
    });
  await db
    .update(activities)
    .set({
      streamsSyncedAt: now,
      hasHeartrate,
      updatedAt: now,
      // A power ride without weighted watts is scored from its watts stream, which arrives after
      // history: rescore it.
      ...(streams.watts?.data?.length ? { trainingLoad: null, loadSource: null } : {}),
    })
    .where(eq(activities.id, activityId));
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
