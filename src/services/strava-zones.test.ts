import { describe, expect, it } from "vite-plus/test";

import { zoneTopsFromStrava } from "./strava-zones.ts";

const ranges = (bounds: number[]) =>
  bounds.slice(0, -1).map((min, index) => ({ min, max: bounds[index + 1] }));

describe("zoneTopsFromStrava", () => {
  it("tops each zone one beat below where Strava starts the next", () => {
    const zones = { heart_rate: { zones: ranges([0, 123, 153, 169, 184, -1]) } };

    expect(zoneTopsFromStrava(zones)).toEqual([122, 152, 168, 183]);
  });

  it("has nothing to copy without five heart-rate zones", () => {
    expect(zoneTopsFromStrava({})).toBeNull();
    expect(zoneTopsFromStrava({ heart_rate: { zones: ranges([0, 123, 153, -1]) } })).toBeNull();
  });

  it("refuses zones VO2 could not save", () => {
    const outOfRange = { heart_rate: { zones: ranges([0, 30, 153, 169, 184, -1]) } };
    const notRising = { heart_rate: { zones: ranges([0, 123, 123, 169, 184, -1]) } };

    expect(zoneTopsFromStrava(outOfRange)).toBeNull();
    expect(zoneTopsFromStrava(notRising)).toBeNull();
  });
});
