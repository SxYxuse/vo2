import { describe, expect, test } from "vite-plus/test";

import { staleDerivedCacheIds, type DerivedCacheInputs } from "./activity-derived-cache.ts";

const RIDE: DerivedCacheInputs = {
  id: "1",
  sportType: "Ride",
  distance: 40_000,
  totalElevationGain: 300,
};

describe("staleDerivedCacheIds", () => {
  test("keeps caches when nothing they read changed", () => {
    expect(staleDerivedCacheIds([RIDE], [{ ...RIDE }])).toEqual([]);
  });

  test("clears caches after a sport type edit on Strava", () => {
    expect(staleDerivedCacheIds([RIDE], [{ ...RIDE, sportType: "Run" }])).toEqual(["1"]);
  });

  test("clears caches when distance or elevation change", () => {
    const stored = [RIDE, { ...RIDE, id: "2" }];
    const fresh = [
      { ...RIDE, distance: 41_000 },
      { ...RIDE, id: "2", totalElevationGain: null },
    ];
    expect(staleDerivedCacheIds(stored, fresh)).toEqual(["1", "2"]);
  });

  test("keeps caches when only float4 storage rounding differs", () => {
    const stored = {
      ...RIDE,
      distance: Math.fround(40_123.4),
      totalElevationGain: Math.fround(312.7),
    };
    const fresh = { ...RIDE, distance: 40_123.4, totalElevationGain: 312.7 };
    expect(staleDerivedCacheIds([stored], [fresh])).toEqual([]);
  });

  test("ignores activities seen for the first time", () => {
    expect(staleDerivedCacheIds([], [RIDE])).toEqual([]);
  });
});
