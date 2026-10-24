import { describe, expect, it } from "vite-plus/test";

import type { TrainingPlan } from "@/services/training-plan.types.ts";

import { isSetUp } from "./app-shell.ts";

const training: TrainingPlan = {
  restWeekdays: [1],
  longWeekday: 6,
  doubleDays: 0,
  sports: ["cycling", "running"],
  goals: [],
  startWeek: "2026-10-19",
  baselineMinutes: null,
  keySessionSports: {},
  timeZone: "Europe/Paris",
};

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
