import { describe, expect, it } from "vite-plus/test";

import type { FuelPlan } from "./fuel-plan.ts";
import { carryList, profilePoints } from "./route-plan.ts";

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
    items: [],
    intakes: [],
    notes: [],
    issues: [],
    ...overrides,
  };
}

describe("carryList", () => {
  it("lists bottles with their powder, a part-filled last one, and food", () => {
    const lines = carryList(
      plan({
        drink: {
          productId: "power-carb",
          bottles: 2,
          quarters: 7,
          carbsPerBottleG: 122.1,
          powderPerBottleG: 128,
        },
        waterBottles: 1,
        items: [{ productId: "gel-40-mango", role: "gel", count: 4, carbsG: 160 }],
      }),
      products,
    );

    expect(lines).toEqual([
      "3 × 750 ml bottles: 2 POWER CARB Pineapple (128 g powder), last one 3/4 full, 1 water",
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
      atSec: index * 7,
      speedKmh: 25,
    }));
    const points = profilePoints(steps);

    expect(points.length).toBeLessThanOrEqual(401);
    expect(points.at(-1)?.km).toBe(200);
  });
});
