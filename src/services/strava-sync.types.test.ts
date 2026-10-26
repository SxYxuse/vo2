import { describe, expect, it } from "vite-plus/test";

import {
  autoResumePlan,
  deriveSyncKind,
  historyCompleteFromRun,
  isAbortError,
  isOverSyncBudget,
  isTransientSyncError,
  remainingSyncBudgetMs,
  stopsAfterNewestPage,
  storedPauseResult,
  SYNC_REQUEST_BUDGET_MS,
  summarizeSyncStatus,
  type SyncStatus,
} from "./strava-sync.types.ts";

describe("deriveSyncKind", () => {
  const base = {
    hasRun: true,
    activityCount: 10,
    streamsPending: 0,
    historyComplete: true,
    pausedUntil: null,
    lastError: null,
  };

  it("is never when no run and no activities", () => {
    expect(deriveSyncKind({ ...base, hasRun: false, activityCount: 0 })).toBe("never");
  });

  it("is incomplete when activities exist without streams", () => {
    expect(
      deriveSyncKind({
        ...base,
        hasRun: true,
        streamsPending: 4,
        historyComplete: false,
      }),
    ).toBe("incomplete");
  });

  it("is complete only when history is caught up and every activity has streams", () => {
    expect(deriveSyncKind(base)).toBe("complete");
  });

  it("is paused while a rate-limit window is still open", () => {
    expect(
      deriveSyncKind({
        ...base,
        pausedUntil: "2099-01-01T00:00:00.000Z",
        lastError: "rate limit",
      }),
    ).toBe("paused");
  });

  it("is failed when the last copy errored without a pause", () => {
    expect(deriveSyncKind({ ...base, lastError: "Strava request failed (500)" })).toBe("failed");
  });

  it("is incomplete after a rate-limit pause expires", () => {
    expect(
      deriveSyncKind({
        ...base,
        streamsPending: 4,
        historyComplete: false,
        pausedUntil: "2020-01-01T00:00:00.000Z",
        lastError: "rate limit",
      }),
    ).toBe("incomplete");
  });
});

describe("historyCompleteFromRun", () => {
  it("treats a finished idle row with no pending streams as caught up", () => {
    expect(historyCompleteFromRun("idle", 0)).toBe(true);
  });

  it("does not treat idle plus pending streams as a full success", () => {
    expect(historyCompleteFromRun("idle", 12)).toBe(false);
  });
});

describe("sync request budget", () => {
  it("yields once the copy has used its budget", () => {
    expect(isOverSyncBudget(0, SYNC_REQUEST_BUDGET_MS - 1)).toBe(false);
    expect(isOverSyncBudget(0, SYNC_REQUEST_BUDGET_MS)).toBe(true);
    expect(remainingSyncBudgetMs(1_000, 4_000)).toBe(3_000);
  });
});

describe("transient sync errors", () => {
  it("treats a closed connection as retryable", () => {
    const abort = new Error("The connection was closed.");
    abort.name = "AbortError";
    expect(isAbortError(abort)).toBe(true);
    expect(isTransientSyncError(abort)).toBe(true);
    expect(isTransientSyncError(new Error("The connection was closed."))).toBe(true);
  });

  it("treats TanStack Start's missing-response invariant as retryable", () => {
    expect(isTransientSyncError(new Error("Invariant failed"))).toBe(true);
    expect(
      isTransientSyncError(new Error("Invariant failed: expected content-type header to be set")),
    ).toBe(true);
  });

  it("does not retry a real Strava failure", () => {
    expect(isTransientSyncError(new Error("Strava request failed (500) /activities"))).toBe(false);
    expect(isAbortError(new Error("Strava request failed (500) /activities"))).toBe(false);
  });
});

describe("stopsAfterNewestPage", () => {
  it("returns early on the first copy once the newest page holds activities", () => {
    expect(stopsAfterNewestPage({ firstCopy: true, newestUpserted: 200 })).toBe(true);
  });

  it("keeps going when the athlete has no activities on Strava", () => {
    expect(stopsAfterNewestPage({ firstCopy: true, newestUpserted: 0 })).toBe(false);
  });

  it("keeps going once a local copy already exists", () => {
    expect(stopsAfterNewestPage({ firstCopy: false, newestUpserted: 3 })).toBe(false);
  });
});

describe("autoResumePlan", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");

  it("resumes an incomplete local copy", () => {
    expect(
      autoResumePlan({ status: "incomplete", pausedUntil: null, lastAttemptAt: null }, now),
    ).toEqual({
      kind: "sync",
    });
  });

  it("waits for an active pause to end", () => {
    expect(
      autoResumePlan(
        { status: "paused", pausedUntil: "2026-10-20T10:15:00Z", lastAttemptAt: null },
        now,
      ),
    ).toEqual({
      kind: "wait",
      until: Date.parse("2026-10-20T10:15:00Z"),
    });
  });

  it("never starts the first copy or retries a failed one on its own", () => {
    expect(
      autoResumePlan({ status: "never", pausedUntil: null, lastAttemptAt: null }, now),
    ).toEqual({ kind: "idle" });
    expect(
      autoResumePlan({ status: "failed", pausedUntil: null, lastAttemptAt: null }, now),
    ).toEqual({ kind: "idle" });
  });

  it("checks a complete local copy for new activities once 15 minutes have passed", () => {
    const complete = { status: "complete", pausedUntil: null } as const;
    expect(autoResumePlan({ ...complete, lastAttemptAt: "2026-10-20T09:45:00Z" }, now)).toEqual({
      kind: "check",
    });
    expect(autoResumePlan({ ...complete, lastAttemptAt: "2026-10-20T09:46:00Z" }, now)).toEqual({
      kind: "idle",
    });
  });
});

describe("storedPauseResult", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  const run = {
    status: "paused",
    pausedUntil: new Date("2026-10-20T10:15:00Z"),
    lastError: "Strava 15-minute read rate limit reached",
    shortLimitRemaining: 3,
    dailyLimitRemaining: 640,
  };

  it("answers from a pause still in force", () => {
    expect(storedPauseResult(run, 12, now)).toEqual({
      activitiesUpserted: 0,
      streamsFetched: 0,
      streamsPending: 12,
      historyComplete: false,
      done: false,
      pausedUntil: "2026-10-20T10:15:00.000Z",
      lastError: "Strava 15-minute read rate limit reached",
      alreadyRunning: false,
      rateLimit: {
        shortRemaining: 3,
        dailyRemaining: 640,
        nextWindowAt: "2026-10-20T10:15:00.000Z",
      },
    });
  });

  it("lets the sync run once the pause has passed", () => {
    expect(storedPauseResult(run, 12, Date.parse("2026-10-20T10:15:00Z"))).toBeNull();
  });

  it("lets the sync run without a stored pause or run", () => {
    expect(storedPauseResult({ ...run, pausedUntil: null }, 12, now)).toBeNull();
    expect(storedPauseResult(null, 0, now)).toBeNull();
  });
});

describe("summarizeSyncStatus", () => {
  const now = Date.parse("2026-10-24T08:30:00Z");
  const status: SyncStatus = {
    activityCount: 44,
    streamsPending: 0,
    streamsCopied: 44,
    status: "complete",
    historyComplete: true,
    pausedUntil: null,
    lastError: null,
    lastAttemptAt: "2026-10-24T08:21:00Z",
    shortLimitRemaining: null,
    dailyLimitRemaining: null,
  };

  it("says how long ago a full copy ran", () => {
    expect(summarizeSyncStatus(status, now)).toMatchObject({
      label: "Synced 9 minutes ago",
      tone: "ok",
    });
  });

  it("reads a copy from the last minute, or a server clock ahead of the device, as just now", () => {
    expect(
      summarizeSyncStatus({ ...status, lastAttemptAt: "2026-10-24T08:29:30Z" }, now).label,
    ).toBe("Synced just now");
    expect(
      summarizeSyncStatus({ ...status, lastAttemptAt: "2026-10-24T08:30:02Z" }, now).label,
    ).toBe("Synced just now");
  });

  it("flags a copy that still has history to fetch", () => {
    expect(summarizeSyncStatus({ ...status, status: "incomplete" }, now).tone).toBe("attention");
  });

  it("shows a rate-limit pause only while it lasts", () => {
    const paused = { ...status, status: "paused" as const, pausedUntil: "2026-10-24T09:00:00Z" };
    expect(summarizeSyncStatus(paused, now)).toMatchObject({ tone: "attention" });
    expect(summarizeSyncStatus(paused, now).label).toMatch(/^Paused until /);
    expect(summarizeSyncStatus(paused, Date.parse("2026-10-24T09:05:00Z")).label).toMatch(
      /^Synced /,
    );
  });

  it("calls out failures and copies that never ran", () => {
    expect(summarizeSyncStatus({ ...status, status: "failed" }, now).tone).toBe("error");
    expect(
      summarizeSyncStatus({ ...status, status: "never", lastAttemptAt: null }, now),
    ).toMatchObject({
      label: "Not synced",
      tone: "idle",
    });
    expect(summarizeSyncStatus(null, now).label).toBe("Sync");
  });
});
