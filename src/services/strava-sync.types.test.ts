import { describe, expect, it } from "vite-plus/test";

import { deriveSyncKind, historyCompleteFromRun } from "./strava-sync.types.ts";

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
