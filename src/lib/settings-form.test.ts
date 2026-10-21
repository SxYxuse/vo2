import { describe, expect, it } from "vite-plus/test";

import {
  onboardingFormDefaults,
  onboardingFormSchema,
  profileFormSchema,
  profileFromForm,
  settingsFormDefaults,
  settingsFormSchema,
} from "./settings-form.ts";

const plan = {
  buildPace: "steady",
  targetMode: "auto",
  hoursIntent: "keep",
  weekMix: { minSessions: 5, maxSessions: 5, keyShare: 20, doubleDays: 0 },
  keySessionSports: {},
  targetWeeklyHours: 6,
  preferredRestWeekday: 0,
  timeZone: "Europe/Paris",
} as const;

const profile = { birthDate: "1990-05-14", weightKg: 72 };

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
        profile,
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

  it("accepts settings saved before any sport type has been copied", () => {
    const result = settingsFormSchema.safeParse(
      settingsFormDefaults({
        profile,
        training: plan,
        sportTypes: {},
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("flags the profile section when the birthday is missing", () => {
    const result = settingsFormSchema.safeParse(
      settingsFormDefaults({
        profile: { birthDate: null, weightKg: 72 },
        training: plan,
        sportTypes: {},
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(issuePaths(result)).toEqual(["birthDate"]);
  });

  it("flags the profile section when the weight is missing", () => {
    const result = settingsFormSchema.safeParse(
      settingsFormDefaults({
        profile: { birthDate: "1990-05-14", weightKg: null },
        training: plan,
        sportTypes: {},
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(issuePaths(result)).toEqual(["weightKg"]);
  });
});

describe("profileFormSchema", () => {
  it.each(["29.9", "200.1", "abc"])("rejects a weight of %s", (weightKg) => {
    const result = profileFormSchema.safeParse({ birthDate: "1990-05-14", weightKg });

    expect(issuePaths(result)).toEqual(["weightKg"]);
  });

  it("reads a comma decimal and keeps one decimal", () => {
    const values = profileFormSchema.parse({ birthDate: "1990-05-14", weightKg: " 72,46 " });

    expect(profileFromForm(values)).toEqual({ birthDate: "1990-05-14", weightKg: 72.5 });
  });
});

describe("onboardingFormSchema", () => {
  it("flags the sports step when every sport type is hidden", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        profile,
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
        profile,
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
        profile,
        training: plan,
        sportTypes: {},
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("flags the about step when the birthday is missing", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        profile: null,
        training: plan,
        sportTypes: {},
        sportGroupShares: undefined,
        avgHours: 5,
        timeZone: "Europe/Paris",
      }),
    );

    expect(issuePaths(result)).toEqual(["birthDate", "weightKg"]);
  });
});
