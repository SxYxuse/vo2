import { describe, expect, it } from "vite-plus/test";

import { appSettingsSaveSchema } from "./app-settings.types.ts";

const profile = { birthDate: "1990-05-14" };

function sport(visible: boolean) {
  return { visible, color: "var(--color-ds-blue-700)", heartRate: true, power: false };
}

describe("appSettingsSaveSchema", () => {
  it("rejects a save that hides every sport type", () => {
    const result = appSettingsSaveSchema.safeParse({
      profile,
      sportTypes: { Run: sport(false), Ride: sport(false) },
      sportGroupShares: {},
    });

    expect(result.success).toBe(false);
  });

  it("accepts a save that keeps one sport type shown", () => {
    const result = appSettingsSaveSchema.safeParse({
      profile,
      sportTypes: { Run: sport(false), Ride: sport(true) },
      sportGroupShares: {},
    });

    expect(result.success).toBe(true);
  });

  it("accepts a save before any sport type has been copied", () => {
    const result = appSettingsSaveSchema.safeParse({
      profile,
      sportTypes: {},
      sportGroupShares: {},
    });

    expect(result.success).toBe(true);
  });

  it("rejects a save that clears the birthday", () => {
    const result = appSettingsSaveSchema.safeParse({
      profile: { birthDate: null },
      sportTypes: {},
      sportGroupShares: {},
    });

    expect(result.success).toBe(false);
  });
});
