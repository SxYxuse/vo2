import { describe, expect, it } from "vite-plus/test";

import type { FuelPlan, Intake } from "./fuel-plan.ts";
import {
  carryList,
  elevationTicks,
  intakeHours,
  profilePoints,
  traceSegments,
} from "./route-plan.ts";

const products = [
  { id: "power-carb", name: "POWER CARB Pineapple" },
  { id: "gel-40-mango", name: "GEL 40 Mango" },
];

function plan(overrides: Partial<FuelPlan>): FuelPlan {
  return {
    spec: {} as FuelPlan["spec"],
    carbTarget: 80,
    targetCarbsG: 240,
    totalCarbsG: 240,
    achievedGph: 80,
    caffeineMg: 0,
    drink: null,
    waterBottles: 0,
    bottleMl: 750,
    fluid: { mlPerHour: 500, refill: null },
    items: [],
    intakes: [],
    notes: [],
    issues: [],
    ...overrides,
  };
}

describe("carryList", () => {
  it("lists bottles with their powder and carbs, then food", () => {
    const lines = carryList(
      plan({
        drink: {
          productId: "power-carb",
          bottles: 2,
          carbsPerBottleG: 122.1,
          powderPerBottleG: 128,
        },
        waterBottles: 1,
        items: [{ productId: "gel-40-mango", role: "gel", count: 4, carbsG: 160 }],
      }),
      products,
    );

    expect(lines).toEqual([
      "3 × 750 ml bottles: 2 POWER CARB Pineapple (128 g powder, 122 g carbs each), 1 water",
      "4 × GEL 40 Mango",
    ]);
  });

  it("says nothing about bottles when none are carried", () => {
    expect(carryList(plan({}), products)).toEqual([]);
  });
});

describe("profilePoints", () => {
  it("thins a long route and keeps its end", () => {
    const steps = Array.from({ length: 4001 }, (_, index) => ({
      distanceM: index * 50,
      lengthM: 50,
      altitudeM: 100,
      gradePct: 0,
      lat: 45,
      lon: 6 + index * 0.0004,
      atSec: index * 7,
      speedKmh: 25,
    }));
    const points = profilePoints(steps);

    expect(points.length).toBeLessThanOrEqual(401);
    expect(points.at(-1)?.km).toBe(200);
    expect(points[0]?.lat).toBe(45);
  });

  it("splits the track so climbs are their own stretches", () => {
    const points = [
      { km: 0, altitudeM: 100, atSec: 0, gradePct: 0, lat: 45, lon: 6 },
      { km: 1, altitudeM: 100, atSec: 120, gradePct: 0, lat: 45.01, lon: 6 },
      { km: 2, altitudeM: 160, atSec: 300, gradePct: 6, lat: 45.02, lon: 6 },
      { km: 3, altitudeM: 220, atSec: 500, gradePct: 6, lat: 45.03, lon: 6 },
      { km: 4, altitudeM: 220, atSec: 620, gradePct: 0, lat: 45.04, lon: 6 },
    ];
    const segments = traceSegments(points, [{ startKm: 1.5, endKm: 3.2, startSec: 240 }]);

    expect(segments.some((segment) => segment.climb && segment.startSec === 240)).toBe(true);
    expect(segments.some((segment) => !segment.climb)).toBe(true);
  });
});

describe("elevationTicks", () => {
  it("uses round steps that cover the profile", () => {
    expect(elevationTicks(130, 1245)).toEqual([0, 500, 1000, 1500]);
    expect(elevationTicks(130, 520)).toEqual([100, 200, 300, 400, 500, 600]);
    expect(elevationTicks(200, 200)).toEqual([200, 300]);
  });
});

describe("intakeHours", () => {
  function intake(atSec: number, role: Intake["role"], carbsG: number): Intake {
    return {
      atSec,
      earliestSec: atSec,
      latestSec: atSec,
      km: 0,
      productId: role,
      role,
      amount: 1,
      carbsG,
      caffeineMg: 0,
      readyAtSec: atSec,
      withFluid: true,
      reason: "",
    };
  }

  it("counts sips in each hour's carbs but lists only food", () => {
    const hours = intakeHours([
      intake(900, "drink", 12.5),
      intake(1200, "gel", 40),
      intake(2100, "drink", 12.5),
      intake(4000, "jelly", 40),
    ]);

    expect(hours).toHaveLength(2);
    expect(hours[0]).toMatchObject({ hour: 0, carbsG: 65 });
    expect(hours[0]?.intakes.map((item) => item.role)).toEqual(["gel"]);
    expect(hours[1]).toMatchObject({ hour: 1, carbsG: 40 });
  });
});
