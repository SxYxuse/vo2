import { format, formatDistanceStrict } from "date-fns";

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

export function stopsAfterNewestPage(input: { firstCopy: boolean; newestUpserted: number }) {
  return input.firstCopy && input.newestUpserted > 0;
}

export const NEW_ACTIVITY_CHECK_GAP_MS = 15 * 60_000;

export type AutoResumePlan =
  | { kind: "sync" }
  | { kind: "check" }
  | { kind: "wait"; until: number }
  | { kind: "idle" };

export function autoResumePlan(
  status: Pick<SyncStatus, "status" | "pausedUntil" | "lastAttemptAt">,
  now = Date.now(),
): AutoResumePlan {
  if (status.status === "incomplete") return { kind: "sync" };
  if (status.status === "complete") {
    const last = status.lastAttemptAt ? new Date(status.lastAttemptAt).getTime() : 0;
    return now - last >= NEW_ACTIVITY_CHECK_GAP_MS ? { kind: "check" } : { kind: "idle" };
  }
  if (status.status === "paused" && status.pausedUntil) {
    const until = new Date(status.pausedUntil).getTime();
    if (until > now) return { kind: "wait", until };
  }
  return { kind: "idle" };
}

export type SyncResult = {
  activitiesUpserted: number;
  streamsFetched: number;
  streamsPending: number;
  historyComplete: boolean;
  done: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  alreadyRunning: boolean;
  rateLimit: {
    shortRemaining: number;
    dailyRemaining: number;
    nextWindowAt: string;
  };
};

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

/**
 * Strava no longer accepts VO2's stored tokens: the refresh was refused or the API answered 401,
 * for example after the athlete deauthorized the app (issue #59). Only signing in again recovers.
 */
export const STRAVA_RECONNECT_MESSAGE =
  "Strava no longer accepts VO2's access. Reconnect Strava to keep syncing.";

export function needsStravaReconnect(error: unknown): error is Error {
  return error instanceof Error && error.message === STRAVA_RECONNECT_MESSAGE;
}

export function isTransientSyncError(error: unknown) {
  if (isAbortError(error)) return true;
  if (!(error instanceof Error)) return false;
  if (error.message === "The connection was closed.") return true;
  return error.message === "Invariant failed" || error.message.startsWith("Invariant failed:");
}

export type SyncTone = "ok" | "attention" | "error" | "idle";

export function summarizeSyncStatus(
  status: SyncStatus | null,
  now: number,
): { label: string; tone: SyncTone; description: string } {
  if (!status) return { label: "Sync", tone: "idle", description: "Sync from Strava" };
  const last = status.lastAttemptAt ? new Date(status.lastAttemptAt) : null;
  const ago = last
    ? now - last.getTime() < 60_000
      ? "just now"
      : formatDistanceStrict(last, now, { addSuffix: true })
    : null;
  const pausedUntil = status.pausedUntil ? new Date(status.pausedUntil) : null;
  if (status.status === "paused" && pausedUntil && pausedUntil.getTime() > now) {
    const until = format(pausedUntil, "HH:mm");
    return {
      label: `Paused until ${until}`,
      tone: "attention",
      description: `Strava asked VO2 to pause until ${until}. Sync from Strava`,
    };
  }
  if (status.status === "failed") {
    return { label: "Sync failed", tone: "error", description: "Last sync failed. Sync again" };
  }
  if (status.status === "never") {
    return { label: "Not synced", tone: "idle", description: "Never synced. Sync from Strava" };
  }
  const label = ago ? `Synced ${ago}` : "Synced";
  if (status.status === "incomplete") {
    return {
      label,
      tone: "attention",
      description: `${label}, older history still copying. Sync from Strava`,
    };
  }
  return { label, tone: "ok", description: `${label}. Sync from Strava` };
}
