import { describe, expect, it } from "vite-plus/test";

import { mergeCalendarSettings } from "./calendar-settings.types.ts";

describe("mergeCalendarSettings", () => {
  it("fills sport types from imported activities when stored settings have none", () => {
    const settings = mergeCalendarSettings(null, ["Run", "Ride", "Swim", "Run"]);

    expect(Object.keys(settings.sportTypes).sort()).toEqual(["Ride", "Run", "Swim"]);
    expect(settings.sportTypes.Run?.visible).toBe(true);
    expect(settings.sportTypes.Ride?.color).toBe("var(--color-ds-blue-700)");
    expect(settings.sportTypes.Swim?.color).toBe("var(--color-ds-teal-700)");
  });

  it("keeps stored visibility and color for a type that still appears on activities", () => {
    const settings = mergeCalendarSettings(
      {
        sportTypes: {
          Run: {
            visible: false,
            color: "var(--color-ds-pink-700)",
            heartRate: true,
            power: false,
          },
        },
        sportGroupShares: {},
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
