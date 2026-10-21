import { describe, expect, it } from "vite-plus/test";

import { isSetUp } from "./app-shell.ts";

const training = {
  buildPace: "steady",
  targetMode: "auto",
  hoursIntent: "keep",
  weekMix: { minSessions: 5, maxSessions: 5, keyShare: 20, doubleDays: 0 },
  keySessionSports: {},
  targetWeeklyHours: 6,
  preferredRestWeekday: 0,
  timeZone: "Europe/Paris",
} as const;

describe("isSetUp", () => {
  it("opens the app once the plan and profile are both set", () => {
    expect(isSetUp({ signedIn: true, training, hasProfile: true })).toBe(true);
  });

  it("holds back an athlete who onboarded before the profile was required", () => {
    expect(isSetUp({ signedIn: true, training, hasProfile: false })).toBe(false);
  });

  it("holds back an athlete still in onboarding", () => {
    expect(isSetUp({ signedIn: true, training: null, hasProfile: true })).toBe(false);
  });
});
