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
  rateLimit: {
    shortRemaining: number;
    dailyRemaining: number;
    nextWindowAt: string;
  };
};

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
