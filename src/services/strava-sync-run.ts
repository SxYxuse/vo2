import {
  StravaApiError,
  type StreamSet,
  type SummaryActivity,
} from "@/integrations/strava/client.ts";
import { StravaDailyLimitError, StravaShortLimitError } from "@/integrations/strava/rate-limit.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import type { SyncKind, SyncResult } from "./strava-sync.types.ts";
import {
  isAbortError,
  isOverSyncBudget,
  remainingSyncBudgetMs,
  SYNC_POSTPROCESS_MIN_MS,
  stopsAfterNewestPage,
  storedPauseResult,
  STRAVA_RECONNECT_MESSAGE,
} from "./strava-sync.types.ts";

const ACTIVITY_PAGE_SIZE = 200;
const ACTIVITY_PAGES_PER_CALL = 1;
const STREAM_BATCH_SIZE = 25;
const STREAM_RETRY_ATTEMPTS = 3;
/** Re-pull this many already-stored activities so title/sport edits land after a late Strava change. */
const RECENT_REFRESH_COUNT = 3;
/** Reads kept back so the athlete's other Strava apps aren't starved mid-window. */
const SHORT_LIMIT_RESERVE = 5;

/** The Strava reads one sync needs; `StravaApi` is the production adapter. */
export type StravaReader = {
  listAthleteActivities(params: {
    page: number;
    perPage: number;
    after?: number;
    before?: number;
  }): Promise<SummaryActivity[]>;
  getActivityStreams(activityId: string): Promise<StreamSet>;
  readonly rateLimit: {
    readonly shortRemaining: number;
    snapshot(): { shortRemaining: number; dailyRemaining: number; nextWindowAt: string };
  };
};

export type StoredSyncRun = NonNullable<Parameters<typeof storedPauseResult>[0]>;

export type RecordedSyncRun = {
  status: Exclude<SyncKind, "never">;
  activitiesUpserted: number;
  streamsFetched: number;
  streamsPending: number;
  shortLimitRemaining: number;
  dailyLimitRemaining: number;
  pausedUntil: Date | null;
  lastError: string | null;
};

/** One athlete's local copy; the Postgres adapter lives in `strava-sync.server.ts`. */
export type SyncStore = {
  readRun(): Promise<StoredSyncRun | null>;
  recordRun(run: RecordedSyncRun): Promise<void>;
  streamsPending(): Promise<number>;
  /** Start dates of the newest stored activities, newest first. */
  newestStartDates(limit: number): Promise<Date[]>;
  oldestStartDate(): Promise<Date | null>;
  upsertActivities(activities: SummaryActivity[]): Promise<number>;
  /** Activities still waiting for streams, newest first. */
  activitiesWithoutStreams(limit: number): Promise<{ id: string; manual: boolean }[]>;
  storeStreams(activityId: string, streams: StreamSet): Promise<void>;
  /** Marks activities whose streams were stored before the flag existed. */
  stampStoredStreams(): Promise<void>;
  athleteExists(): Promise<boolean>;
  refreshTrainingLoads(): Promise<void>;
};

export type SyncDeps = {
  store: SyncStore;
  /** Opened only when the run reaches Strava, so a stored pause costs no token refresh. */
  openStrava: () => Promise<StravaReader>;
  now?: () => number;
};

/** One sync call: copies a page of history, then streams, within the request budget (ADR 0002). */
export async function syncAthlete({
  store,
  openStrava,
  now = Date.now,
}: SyncDeps): Promise<SyncResult> {
  const [run, pendingAtStart] = await Promise.all([store.readRun(), store.streamsPending()]);
  const paused = storedPauseResult(run, pendingAtStart, now());
  if (paused) {
    logger.info("sync.skip_paused", { pausedUntil: paused.pausedUntil });
    return paused;
  }

  logger.info("sync.start");
  const startedAt = now();
  const overBudget = () => isOverSyncBudget(startedAt, now());
  const [, strava] = await Promise.all([store.stampStoredStreams(), openStrava()]);
  let activitiesUpserted = 0;
  let streamsFetched = 0;
  let historyComplete = false;
  let lastError: string | null = null;
  let pausedUntil: Date | null = null;
  let athleteDeleted = false;

  try {
    let newerCaughtUp = false;
    let olderCaughtUp = false;
    const firstCopy = (await store.oldestStartDate()) == null;
    let newestOnly = false;
    if (!overBudget()) {
      const newer = await upsertNewerActivities(strava, store);
      activitiesUpserted += newer.upserted;
      newerCaughtUp = newer.caughtUp;
      newestOnly = stopsAfterNewestPage({ firstCopy, newestUpserted: newer.upserted });
    }
    if (!newestOnly && !overBudget()) {
      const older = await upsertOlderActivities(strava, store);
      activitiesUpserted += older.upserted;
      olderCaughtUp = older.caughtUp;
    }
    historyComplete = newerCaughtUp && olderCaughtUp;
    // History first: older pages are 200 activities per read and settle fitness; streams cost a
    // read each and only feed maps and charts.
    if (historyComplete && !overBudget()) {
      streamsFetched = await syncPendingStreams(strava, store, overBudget);
    }
  } catch (error) {
    if (error instanceof StravaDailyLimitError) {
      pausedUntil = startOfNextUtcDay(new Date(now()));
      lastError = error.message;
      logger.warn("sync.daily_limit", { pausedUntil: pausedUntil.toISOString() });
    } else if (error instanceof StravaShortLimitError) {
      pausedUntil = new Date(strava.rateLimit.snapshot().nextWindowAt);
      lastError = error.message;
      logger.warn("sync.short_limit", { pausedUntil: pausedUntil.toISOString() });
    } else if (error instanceof StravaApiError && error.status === 401) {
      lastError = STRAVA_RECONNECT_MESSAGE;
      logger.warn("sync.strava_unauthorized", errorFields(error));
    } else if (isAbortError(error)) {
      logger.warn("sync.request_aborted", errorFields(error));
    } else if (!(await store.athleteExists())) {
      athleteDeleted = true;
    } else {
      lastError = error instanceof Error ? error.message : "Sync failed";
      logger.error("sync.failed", errorFields(error));
    }
  }

  const snapshot = strava.rateLimit.snapshot();
  const rateLimit = {
    shortRemaining: snapshot.shortRemaining,
    dailyRemaining: snapshot.dailyRemaining,
    nextWindowAt: snapshot.nextWindowAt,
  };

  // Athlete deletion ran mid-sync: stop quietly, there is nothing left to write to.
  if (athleteDeleted || !(await store.athleteExists())) {
    logger.info("sync.stopped_athlete_deleted");
    return {
      activitiesUpserted,
      streamsFetched,
      streamsPending: 0,
      historyComplete: false,
      done: false,
      pausedUntil: null,
      lastError: null,
      alreadyRunning: false,
      rateLimit,
    };
  }

  if (remainingSyncBudgetMs(startedAt, now()) > SYNC_POSTPROCESS_MIN_MS) {
    await store.refreshTrainingLoads();
  } else {
    logger.debug("sync.skip_postprocess_budget");
  }

  const streamsPending = await store.streamsPending();
  if (
    !pausedUntil &&
    snapshot.shortRemaining <= SHORT_LIMIT_RESERVE &&
    (!historyComplete || streamsPending > 0)
  ) {
    pausedUntil = new Date(snapshot.nextWindowAt);
  }
  const done = streamsPending === 0 && historyComplete && !pausedUntil;
  const status = pausedUntil ? "paused" : lastError ? "failed" : done ? "complete" : "incomplete";
  await store.recordRun({
    status,
    activitiesUpserted,
    streamsFetched,
    streamsPending,
    shortLimitRemaining: snapshot.shortRemaining,
    dailyLimitRemaining: snapshot.dailyRemaining,
    pausedUntil,
    lastError,
  });

  if (lastError && !pausedUntil) {
    throw new Error(lastError);
  }

  logger.info("sync.end", {
    activitiesUpserted,
    streamsFetched,
    streamsPending,
    historyComplete,
    done,
    status,
    pausedUntil: pausedUntil?.toISOString() ?? null,
    lastError,
    shortRemaining: snapshot.shortRemaining,
    dailyRemaining: snapshot.dailyRemaining,
  });

  return {
    activitiesUpserted,
    streamsFetched,
    streamsPending,
    historyComplete,
    done,
    pausedUntil: pausedUntil?.toISOString() ?? null,
    lastError,
    alreadyRunning: false,
    rateLimit,
  };
}

function toEpoch(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

async function upsertNewerActivities(strava: StravaReader, store: SyncStore) {
  const lookback = (await store.newestStartDates(RECENT_REFRESH_COUNT)).at(-1);
  // `after` is exclusive. Step back one second so the lookback activities themselves return
  // alongside anything newer — late title or sport-type edits on Strava then upsert.
  const after = lookback ? toEpoch(lookback) - 1 : undefined;
  return upsertActivityPages(strava, store, { after });
}

async function upsertOlderActivities(strava: StravaReader, store: SyncStore) {
  const oldest = await store.oldestStartDate();
  if (!oldest) return { upserted: 0, caughtUp: true };
  return upsertActivityPages(strava, store, { before: toEpoch(oldest) });
}

async function upsertActivityPages(
  strava: StravaReader,
  store: SyncStore,
  bounds: { after?: number; before?: number },
) {
  let page = 1;
  let upserted = 0;
  while (page <= ACTIVITY_PAGES_PER_CALL) {
    const pageItems = await strava.listAthleteActivities({
      page,
      perPage: ACTIVITY_PAGE_SIZE,
      after: bounds.after,
      before: bounds.before,
    });
    logger.debug("sync.activities_page", {
      page,
      count: pageItems.length,
      after: bounds.after ?? null,
      before: bounds.before ?? null,
    });
    if (pageItems.length === 0) return { upserted, caughtUp: true };
    if (
      bounds.before != null &&
      !pageItems.some((activity) => activityStartsBefore(activity, bounds.before!))
    ) {
      return { upserted, caughtUp: true };
    }
    upserted += await store.upsertActivities(pageItems);
    if (pageItems.length < ACTIVITY_PAGE_SIZE) return { upserted, caughtUp: true };
    page += 1;
  }
  return { upserted, caughtUp: false };
}

function activityStartsBefore(activity: SummaryActivity, beforeEpoch: number) {
  if (!activity.start_date) return false;
  return toEpoch(new Date(activity.start_date)) < beforeEpoch;
}

async function syncPendingStreams(
  strava: StravaReader,
  store: SyncStore,
  overBudget: () => boolean,
) {
  const pending = await store.activitiesWithoutStreams(STREAM_BATCH_SIZE);
  logger.debug("sync.streams_batch", { pending: pending.length });
  let fetched = 0;
  for (const row of pending) {
    if (overBudget()) {
      logger.debug("sync.budget_stop", { fetched, pending: pending.length });
      break;
    }
    if (strava.rateLimit.shortRemaining <= SHORT_LIMIT_RESERVE) break;
    const streams = row.manual ? {} : await fetchStreamsWithRetry(strava, row.id);
    await store.storeStreams(row.id, streams);
    fetched += 1;
  }
  return fetched;
}

function shouldRetryStreamFetch(error: unknown) {
  if (error instanceof StravaDailyLimitError || error instanceof StravaShortLimitError) {
    return false;
  }
  if (error instanceof StravaApiError && error.status >= 400 && error.status < 500) return false;
  return true;
}

async function fetchStreamsWithRetry(strava: StravaReader, activityId: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await strava.getActivityStreams(activityId);
    } catch (error) {
      if (!shouldRetryStreamFetch(error) || attempt === STREAM_RETRY_ATTEMPTS) throw error;
      logger.warn("sync.stream_retry", { activityId, attempt, ...errorFields(error) });
    }
  }
}

function startOfNextUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
