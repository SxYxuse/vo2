import { describe, expect, it } from "vite-plus/test";

import {
  onboardingFormDefaults,
  onboardingFormSchema,
  settingsFormDefaults,
  settingsFormSchema,
} from "./settings-form.ts";

const plan = {
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

function sport(visible: boolean) {
  return { visible, color: "var(--color-ds-blue-700)", heartRate: true, power: false };
}

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("settingsFormSchema", () => {
  it("flags the sports section when every sport type is hidden", () => {
    const result = settingsFormSchema.safeParse(
      settingsFormDefaults({
        profile: null,
        training: plan,
        sportTypes: { Run: sport(false), Walk: sport(false) },
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["sportTypes"]);
  });
});

describe("onboardingFormSchema", () => {
  it("flags the sports step when every sport type is hidden", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        training: plan,
        sportTypes: { Run: sport(false), Walk: sport(false) },
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["sportTypes"]);
  });

  it("accepts an athlete who keeps one sport shown", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        training: plan,
        sportTypes: { Run: sport(true), Walk: sport(false) },
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts an athlete with no copied activities yet", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        training: plan,
        sportTypes: {},
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(result.success).toBe(true);
  });
});
