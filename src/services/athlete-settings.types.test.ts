import { describe, expect, it } from "vite-plus/test";

import {
  familyCollectors,
  isSportTypeShown,
  mergeAthleteSettings,
  nextTopEffortsSince,
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

  it("lists only sport-group types, never an other sport type", () => {
    const settings = mergeAthleteSettings(
      {
        sportTypes: { Yoga: sport(true) },
        sportGroupShares: {},
        calendarPeriod: "month",
        topEffortsSince: null,
      },
      ["Run", "WeightTraining", "Yoga", "Hike"],
    );

    expect(Object.keys(settings.sportTypes)).toEqual(["Hike", "Run"]);
  });

  it("keeps stored visibility and color for a type that still appears on activities", () => {
    const settings = mergeAthleteSettings(
      {
        sportTypes: {
          Run: { visible: false, color: "var(--color-ds-pink-700)", heartRate: true, power: false },
        },
        sportGroupShares: {},
        calendarPeriod: "month",
        topEffortsSince: null,
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

  it("shows a shown sport type and a sport-group type the settings don't know yet", () => {
    expect(isSportTypeShown(sportTypes, "Run")).toBe(true);
    expect(isSportTypeShown(sportTypes, "GravelRide")).toBe(true);
  });

  it("never shows an other sport type, even one stored as shown", () => {
    expect(isSportTypeShown({ Yoga: sport(true) }, "Yoga")).toBe(false);
    expect(isSportTypeShown(sportTypes, "Rowing")).toBe(false);
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

describe("top 10 effort celebrations switch", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const earlier = "2026-09-01T08:00:00.000Z";

  it("turning it on starts counting from now", () => {
    expect(nextTopEffortsSince(null, true, now)).toBe("2026-10-22T12:00:00.000Z");
  });

  it("staying on keeps the original start", () => {
    expect(nextTopEffortsSince(earlier, true, now)).toBe(earlier);
  });

  it("turning it off clears the start", () => {
    expect(nextTopEffortsSince(earlier, false, now)).toBeNull();
  });

  it("a save without the switch leaves it as it was", () => {
    expect(nextTopEffortsSince(earlier, undefined, now)).toBe(earlier);
    expect(nextTopEffortsSince(null, undefined, now)).toBeNull();
  });
});
