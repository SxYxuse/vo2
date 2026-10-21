import { describe, expect, it } from "vite-plus/test";

import {
  familyCollectors,
  isSportTypeShown,
  mergeAthleteSettings,
  parseAthleteSettings,
  sportTypeColor,
} from "./athlete-settings.types.ts";

function sport(visible: boolean, overrides: { heartRate?: boolean; power?: boolean } = {}) {
  return {
    visible,
    color: "var(--color-ds-blue-700)",
    heartRate: true,
    power: false,
    ...overrides,
  };
}

describe("parseAthleteSettings", () => {
  it("normalises colours and sensors from a stored value", () => {
    const settings = parseAthleteSettings({
      sportTypes: {
        Ride: { visible: true, color: "var(--color-ds-blue-alpha-400)", power: true },
        Run: { visible: false, color: "var(--color-ds-amber-700)", power: true },
      },
    });

    expect(settings?.sportTypes.Ride).toEqual({
      visible: true,
      color: "var(--color-ds-blue-700)",
      heartRate: true,
      power: true,
    });
    // Running has no power sensor to offer.
    expect(settings?.sportTypes.Run?.power).toBe(false);
    expect(settings?.calendarPeriod).toBe("month");
  });

  it("rejects a value that is not athlete settings", () => {
    expect(parseAthleteSettings({ sportTypes: { Run: { color: 3 } } })).toBeNull();
  });
});

describe("mergeAthleteSettings", () => {
  it("fills sport types from copied activities when stored settings have none", () => {
    const settings = mergeAthleteSettings(null, ["Run", "Ride", "Swim", "Run"]);

    expect(Object.keys(settings.sportTypes).sort()).toEqual(["Ride", "Run", "Swim"]);
    expect(settings.sportTypes.Run?.visible).toBe(true);
    expect(settings.sportTypes.Ride?.color).toBe("var(--color-ds-blue-700)");
    expect(settings.sportTypes.Swim?.color).toBe("var(--color-ds-teal-700)");
  });

  it("keeps stored visibility and color for a type that still appears on activities", () => {
    const settings = mergeAthleteSettings(
      {
        sportTypes: {
          Run: { visible: false, color: "var(--color-ds-pink-700)", heartRate: true, power: false },
        },
        sportGroupShares: {},
        calendarPeriod: "month",
      },
      ["Run", "Ride"],
    );

    expect(settings.sportTypes.Run).toMatchObject({
      visible: false,
      color: "var(--color-ds-pink-700)",
    });
    expect(settings.sportTypes.Ride?.visible).toBe(true);
  });
});

describe("isSportTypeShown", () => {
  const sportTypes = { Walk: sport(false), Run: sport(true) };

  it("hides a sport type the athlete hid", () => {
    expect(isSportTypeShown(sportTypes, "Walk")).toBe(false);
  });

  it("shows a shown sport type and one the settings don't know yet", () => {
    expect(isSportTypeShown(sportTypes, "Run")).toBe(true);
    expect(isSportTypeShown(sportTypes, "Rowing")).toBe(true);
  });
});

describe("sportTypeColor", () => {
  it("uses the stored colour, or the sport type's default before settings know it", () => {
    const sportTypes = { Run: { ...sport(true), color: "var(--color-ds-pink-700)" } };

    expect(sportTypeColor(sportTypes, "Run")).toBe("var(--color-ds-pink-700)");
    expect(sportTypeColor(sportTypes, "Ride")).toBe("var(--color-ds-blue-700)");
  });
});

describe("familyCollectors", () => {
  it("counts the sensors of a hidden sport type (ADR 0018)", () => {
    const collectors = familyCollectors(
      {
        Ride: sport(true),
        VirtualRide: sport(false, { power: true }),
      },
      "cycling",
    );

    expect(collectors).toEqual({ heartRate: true, power: true, powerPartial: true });
  });
});
