import { describe, expect, it } from "vite-plus/test";

import { onboardingSyncStep } from "./onboarding-sync.ts";

const idle = { syncing: false, syncFailed: false, syncPaused: false } as const;

describe("onboardingSyncStep", () => {
  it("asks the athlete to start the first sync and keeps Continue locked", () => {
    expect(onboardingSyncStep({ ...idle, status: "never" })).toEqual({
      canContinue: false,
      action: "start",
      phase: "never",
    });
  });

  it("keeps Continue locked while a sync is running", () => {
    expect(onboardingSyncStep({ ...idle, status: "incomplete", syncing: true })).toEqual({
      canContinue: false,
      action: null,
      phase: "syncing",
    });
  });

  it("lets the athlete move on once the copy is complete", () => {
    expect(onboardingSyncStep({ ...idle, status: "complete" })).toEqual({
      canContinue: true,
      action: null,
      phase: "complete",
    });
  });

  it("lets the athlete move on when Strava's rate limit pauses the copy", () => {
    expect(onboardingSyncStep({ ...idle, status: "paused" })).toEqual({
      canContinue: true,
      action: null,
      phase: "paused",
    });
  });

  it("still lets the athlete move on after this session's pause window has passed", () => {
    expect(onboardingSyncStep({ ...idle, status: "incomplete", syncPaused: true })).toEqual({
      canContinue: true,
      action: "sync",
      phase: "paused",
    });
  });

  it("offers a retry and still lets the athlete move on when the copy failed", () => {
    expect(onboardingSyncStep({ ...idle, status: "failed" })).toEqual({
      canContinue: true,
      action: "retry",
      phase: "failed",
    });
  });

  it("treats a sync that threw in this session as failed even if the stored copy looks incomplete", () => {
    expect(onboardingSyncStep({ ...idle, status: "incomplete", syncFailed: true })).toEqual({
      canContinue: true,
      action: "retry",
      phase: "failed",
    });
  });

  it("asks an athlete with a partial copy to sync before moving on", () => {
    expect(onboardingSyncStep({ ...idle, status: "incomplete" })).toEqual({
      canContinue: false,
      action: "sync",
      phase: "incomplete",
    });
  });
});
