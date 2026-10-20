import type { CalendarSettings } from "./calendar-settings.types.ts";
import type { PlannedSession, TrainingPlan } from "./training-plan.types.ts";

export type CalendarActivity = {
  id: string;
  title: string;
  start: string;
  end: string;
  sportType: string;
  distance: number | null;
  movingTime: number;
  hasStreams: boolean;
  hasHeartrate: boolean;
};

export function isMissingHeartrate(
  activity: Pick<CalendarActivity, "hasStreams" | "hasHeartrate">,
) {
  return activity.hasStreams && !activity.hasHeartrate;
}

export type SyncKind = "never" | "complete" | "incomplete" | "paused" | "failed";

export type SyncStatus = {
  activityCount: number;
  streamsPending: number;
  streamsCopied: number;
  status: SyncKind;
  historyComplete: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  shortLimitRemaining: number | null;
  dailyLimitRemaining: number | null;
};

export function deriveSyncKind(input: {
  hasRun: boolean;
  activityCount: number;
  streamsPending: number;
  historyComplete: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  now?: number;
}): SyncKind {
  if (!input.hasRun && input.activityCount === 0) return "never";
  const pauseMs = input.pausedUntil ? new Date(input.pausedUntil).getTime() : 0;
  const paused = pauseMs > (input.now ?? Date.now());
  if (paused) return "paused";
  if (input.lastError && !input.pausedUntil) return "failed";
  if (input.streamsPending > 0 || !input.historyComplete) return "incomplete";
  return "complete";
}

export function historyCompleteFromRun(status: string | null, streamsPending: number) {
  if (status === "complete") return true;
  if (status === "idle") return streamsPending === 0;
  return false;
}

/**
 * The first copy returns as soon as the newest page is stored, so onboarding can move on;
 * older history and streams follow on the next calls (ADR 0012).
 */
export function stopsAfterNewestPage(input: { firstCopy: boolean; newestUpserted: number }) {
  return input.firstCopy && input.newestUpserted > 0;
}

export type AutoResumePlan = { kind: "sync" } | { kind: "wait"; until: number } | { kind: "idle" };

/**
 * While the app is open, an incomplete local copy resumes on its own and an active pause is
 * waited out. The first copy and failed copies still wait for the athlete (ADR 0012).
 */
export function autoResumePlan(
  status: Pick<SyncStatus, "status" | "pausedUntil">,
  now = Date.now(),
): AutoResumePlan {
  if (status.status === "incomplete") return { kind: "sync" };
  if (status.status === "paused" && status.pausedUntil) {
    const until = new Date(status.pausedUntil).getTime();
    if (until > now) return { kind: "wait", until };
  }
  return { kind: "idle" };
}

export type HomeData = {
  signedIn: boolean;
  activities: CalendarActivity[];
  settings: CalendarSettings;
  training: TrainingPlan | null;
  plannedSessions: PlannedSession[];
};

export type SyncResult = {
  activitiesUpserted: number;
  streamsFetched: number;
  streamsPending: number;
  historyComplete: boolean;
  done: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  /** Another request (a second device or tab) holds this athlete's sync; nothing was copied. */
  alreadyRunning: boolean;
  rateLimit: {
    shortRemaining: number;
    dailyRemaining: number;
    nextWindowAt: string;
  };
};

/**
 * While a stored pause is still in force, sync answers from it instead of asking Strava: a read
 * spent only to hear the limit again comes out of the quota the pause is waiting on (ADR 0002).
 */
export function storedPauseResult(
  run: {
    status: string;
    pausedUntil: Date | null;
    lastError: string | null;
    shortLimitRemaining: number | null;
    dailyLimitRemaining: number | null;
  } | null,
  streamsPending: number,
  now = Date.now(),
): SyncResult | null {
  if (!run?.pausedUntil || run.pausedUntil.getTime() <= now) return null;
  const pausedUntil = run.pausedUntil.toISOString();
  return {
    activitiesUpserted: 0,
    streamsFetched: 0,
    streamsPending,
    historyComplete: historyCompleteFromRun(run.status, streamsPending),
    done: false,
    pausedUntil,
    lastError: run.lastError,
    alreadyRunning: false,
    rateLimit: {
      shortRemaining: run.shortLimitRemaining ?? 0,
      dailyRemaining: run.dailyLimitRemaining ?? 0,
      nextWindowAt: pausedUntil,
    },
  };
}

/**
 * Return before Bun.serve's 10s idleTimeout (and typical preview proxies) close
 * the request. The client loops until history and streams are caught up.
 */
export const SYNC_REQUEST_BUDGET_MS = 6_000;
export const SYNC_POSTPROCESS_MIN_MS = 2_000;
export const SYNC_TRANSIENT_RETRIES = 3;

export function isOverSyncBudget(
  startedAt: number,
  now = Date.now(),
  budgetMs = SYNC_REQUEST_BUDGET_MS,
) {
  return now - startedAt >= budgetMs;
}

export function remainingSyncBudgetMs(
  startedAt: number,
  now = Date.now(),
  budgetMs = SYNC_REQUEST_BUDGET_MS,
) {
  return budgetMs - (now - startedAt);
}

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  );
}

export function isTransientSyncError(error: unknown) {
  if (isAbortError(error)) return true;
  if (!(error instanceof Error)) return false;
  if (error.message === "The connection was closed.") return true;
  return error.message === "Invariant failed" || error.message.startsWith("Invariant failed:");
}
