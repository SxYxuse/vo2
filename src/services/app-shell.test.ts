import { describe, expect, it } from "vite-plus/test";

import { isSetUp } from "./app-shell.ts";

const training = {
  buildPace: "steady",
  maxRunSessions: 3,
  maxRideSessions: 2,
  maxDoubleDays: 0,
  hoursIntent: "keep",
  workoutStyle: "hours",
  targetWeeklyHours: 6,
  preferredRestWeekday: 0,
  timeZone: "Europe/Paris",
} as const;

describe("isSetUp", () => {
  it("opens the app once the plan and birthday are both set", () => {
    expect(isSetUp({ signedIn: true, training, hasBirthDate: true })).toBe(true);
  });

  it("holds back an athlete who onboarded before the birthday was required", () => {
    expect(isSetUp({ signedIn: true, training, hasBirthDate: false })).toBe(false);
  });

  it("holds back an athlete still in onboarding", () => {
    expect(isSetUp({ signedIn: true, training: null, hasBirthDate: true })).toBe(false);
  });
});
