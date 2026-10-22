import { describe, expect, it } from "vite-plus/test";

import { athleteSettingsSaveSchema } from "./athlete-settings.ts";

const profile = { birthDate: "1990-05-14", weightKg: 72, heartRateSince: "2026-01-01" };

function sport(visible: boolean) {
  return { visible, color: "var(--color-ds-blue-700)", heartRate: true, power: false };
}

describe("athleteSettingsSaveSchema", () => {
  it("rejects a save that hides every sport type", () => {
    const result = athleteSettingsSaveSchema.safeParse({
      profile,
      sportTypes: { Run: sport(false), Ride: sport(false) },
      sportGroupShares: {},
    });

    expect(result.success).toBe(false);
  });

  it("accepts a save that keeps one sport type shown", () => {
    const result = athleteSettingsSaveSchema.safeParse({
      profile,
      sportTypes: { Run: sport(false), Ride: sport(true) },
      sportGroupShares: {},
    });

    expect(result.success).toBe(true);
  });

  it("accepts a save before any sport type has been copied", () => {
    const result = athleteSettingsSaveSchema.safeParse({
      profile,
      sportTypes: {},
      sportGroupShares: {},
    });

    expect(result.success).toBe(true);
  });

  it("rejects a save that clears the birthday", () => {
    const result = athleteSettingsSaveSchema.safeParse({
      profile: { ...profile, birthDate: null },
      sportTypes: {},
      sportGroupShares: {},
    });

    expect(result.success).toBe(false);
  });

  it("rejects a save that clears the reliable heart rate date", () => {
    const result = athleteSettingsSaveSchema.safeParse({
      profile: { ...profile, heartRateSince: null },
      sportTypes: {},
      sportGroupShares: {},
    });

    expect(result.success).toBe(false);
  });

  it("rejects a save that clears the weight", () => {
    const result = athleteSettingsSaveSchema.safeParse({
      profile: { ...profile, weightKg: null },
      sportTypes: {},
      sportGroupShares: {},
    });

    expect(result.success).toBe(false);
  });
});
