import { describe, expect, it } from "vite-plus/test";

import type { TrainingPlan } from "@/services/training-plan.types.ts";

import {
  onboardingFormDefaults,
  onboardingFormSchema,
  profileFormSchema,
  profileFromForm,
  settingsFormDefaults,
  settingsFormSchema,
  settingsSaveFromForm,
} from "./settings-form.ts";

const plan: TrainingPlan = {
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
        sportTypes: { Run: sport(false), Walk: sport(false) },
        sportGroupShares: undefined,
      }),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["sportTypes"]);
  });

  it("accepts an athlete who keeps one sport shown", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        profile,
        sportTypes: { Run: sport(true), Walk: sport(false) },
        sportGroupShares: undefined,
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts an athlete with no copied activities yet", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        profile,
        sportTypes: {},
        sportGroupShares: undefined,
      }),
    );

    expect(result.success).toBe(true);
  });

  it("flags the about step when the birthday is missing", () => {
    const result = onboardingFormSchema.safeParse(
      onboardingFormDefaults({
        profile: null,
        sportTypes: {},
        sportGroupShares: undefined,
      }),
    );

    expect(issuePaths(result)).toEqual(["birthDate", "weightKg"]);
  });
});

describe("settingsSaveFromForm", () => {
  const saved = {
    profile,
    training: plan,
    settings: { sportTypes: { Run: sport(true) }, sportGroupShares: {}, calendarPeriod: "month" },
  } as never;

  function form(overrides: Record<string, unknown>) {
    return {
      ...settingsFormDefaults({
        profile,
        training: plan,
        sportTypes: { Run: sport(true) },
        sportGroupShares: undefined,
        timeZone: "Europe/Paris",
      }),
      ...overrides,
    };
  }

  it("saves the training edit while a half-typed weight keeps its saved value", () => {
    const result = settingsSaveFromForm(form({ weightKg: "", restWeekdays: [1, 3] }), saved);

    expect(result?.profile).toEqual(profile);
    expect(result?.training?.restWeekdays).toEqual([1, 3]);
  });

  it("keeps the saved plan when the long session day lands on a rest day", () => {
    const result = settingsSaveFromForm(form({ restWeekdays: [1, 6] }), saved);

    expect(result?.training).toEqual(plan);
  });

  it("creates no plan from settings: the plan builder does", () => {
    const result = settingsSaveFromForm(form({}), {
      ...(saved as object),
      training: null,
    } as never);

    expect(result?.training).toBeUndefined();
  });

  it("keeps the saved sport types when every type is hidden", () => {
    const result = settingsSaveFromForm(
      form({ sportTypes: { Run: sport(false) }, weightKg: "70,5" }),
      saved,
    );

    expect(result?.sportTypes).toEqual({ Run: sport(true) });
    expect(result?.profile.weightKg).toBe(70.5);
  });

  it("saves nothing when the profile has never been valid", () => {
    const result = settingsSaveFromForm(form({ weightKg: "" }), {
      ...(saved as object),
      profile: { birthDate: "1990-05-14", weightKg: null },
    } as never);

    expect(result).toBeNull();
  });
});
