import { describe, expect, it } from "vite-plus/test";

import { planningProducts } from "./fuel-catalog.ts";
import {
  checkPlan,
  defaultProposals,
  solveFuelPlan,
  swapOptions,
  swapProduct,
  type FuelPlanInput,
  type ProposalSpec,
} from "./fuel-plan.ts";
import { buildRouteProfile, type GpxPoint } from "./route-gpx.ts";
import { predictRoute } from "./route-prediction.ts";

const products = planningProducts();

/** 90 km: flat, then a 6 % climb of 480 m from km 60 to km 68, then flat. */
function route(distanceKm = 90, climbFromKm = 60) {
  const points: GpxPoint[] = [];
  for (let d = 0; d <= distanceKm * 1000; d += 25) {
    const from = climbFromKm * 1000;
    const ele = d < from ? 100 : d < from + 8000 ? 100 + (d - from) * 0.06 : 580;
    points.push({ lat: 45 + d / 111_195, lon: 6, ele });
  }
  return buildRouteProfile({ name: null, points });
}

function input(overrides: Partial<FuelPlanInput> = {}, sportType = "Ride"): FuelPlanInput {
  const prediction = predictRoute({
    profile: route(),
    sportType,
    history: [],
    now: new Date("2026-10-20T08:00:00Z"),
    form: { ctl: null, tsb: null },
    bodyWeightKg: 70,
  });
  return {
    sportGroup: prediction.sportGroup,
    elapsedSec: prediction.elapsedSec,
    steps: prediction.steps,
    climbs: prediction.climbs,
    carbTarget: 80,
    bottles: { count: 2, ml: 500 },
    bodyWeightKg: 70,
    products,
    ...overrides,
  };
}

function spec(overrides: Partial<ProposalSpec> = {}): ProposalSpec {
  return {
    id: "test",
    name: "Test",
    rationale: "",
    drinkId: "power-carb",
    drinkShare: 0.6,
    gelIds: ["gel-40-mango"],
    barId: null,
    barShare: 0,
    caffeineId: null,
    ...overrides,
  };
}

describe("solveFuelPlan", () => {
  it("hits the carb target over the predicted time", () => {
    const base = input();
    const plan = solveFuelPlan(base, spec());

    expect(base.climbs).toHaveLength(1);
    expect(Math.abs(plan.totalCarbsG - plan.targetCarbsG)).toBeLessThanOrEqual(40);
    expect(plan.achievedGph).toBeGreaterThanOrEqual(70);
    expect(plan.achievedGph).toBeLessThanOrEqual(85);
    expect(plan.issues).toEqual([]);
  });

  it("scales a drink mix to the bottle at the store's strength", () => {
    const plan = solveFuelPlan(input({ bottles: { count: 2, ml: 750 } }), spec());

    // POWER CARB: 81.4 g in 85 g of powder per 500 ml.
    expect(plan.drink?.carbsPerBottleG).toBe(122.1);
    expect(plan.drink?.powderPerBottleG).toBe(128);
  });

  it("caps drink at the bottles carried and moves the rest to gels", () => {
    const plan = solveFuelPlan(
      input({ bottles: { count: 1, ml: 500 } }),
      spec({ drinkShare: 0.9 }),
    );

    expect(plan.drink?.quarters).toBe(4);
    expect(plan.intakes.filter((intake) => intake.role === "drink")).toHaveLength(4);
    expect(plan.notes.join(" ")).toMatch(/bottles cover 81 g/);
    expect(Math.abs(plan.totalCarbsG - plan.targetCarbsG)).toBeLessThanOrEqual(40);
  });

  it("plans water in the bottles left over", () => {
    const plan = solveFuelPlan(input(), spec({ drinkId: null, drinkShare: 0 }));

    expect(plan.drink).toBeNull();
    expect(plan.waterBottles).toBe(2);
    expect(plan.intakes.every((intake) => intake.withFluid)).toBe(true);
  });

  it("has a gel ready at the start of each major climb", () => {
    const base = input();
    const plan = solveFuelPlan(base, spec());

    for (const climb of base.climbs) {
      const ready = plan.intakes.filter(
        (intake) =>
          intake.role === "gel" &&
          intake.readyAtSec <= climb.startSec &&
          intake.readyAtSec >= climb.startSec - 10 * 60,
      );
      expect(ready.length).toBeGreaterThan(0);
      expect(ready[0]?.reason).toMatch(/ready for the climb/);
    }
  });

  it("suggests every time inside its window", () => {
    const plan = solveFuelPlan(input(), spec());

    for (const intake of plan.intakes) {
      expect(intake.earliestSec).toBeLessThanOrEqual(intake.atSec);
      expect(intake.latestSec).toBeGreaterThanOrEqual(intake.atSec);
    }
  });

  it("times caffeine to peak at a late climb, within 3 mg/kg", () => {
    const plan = solveFuelPlan(input(), spec({ caffeineId: "gel-40-caffeine-matcha" }));
    const caffeine = plan.intakes.find((intake) => intake.role === "caffeine");
    const climb = input().climbs[0];

    expect(caffeine?.caffeineMg).toBe(100);
    expect(caffeine?.readyAtSec).toBeLessThanOrEqual((climb?.startSec ?? 0) + 10 * 60);
    expect(caffeine?.atSec).toBeLessThan(climb?.startSec ?? 0);
  });

  it("leaves out caffeine over the athlete's cap", () => {
    // 150 mg is over 3 mg/kg for a 45 kg athlete (135 mg).
    const plan = solveFuelPlan(
      input({ bodyWeightKg: 45 }),
      spec({ caffeineId: "gel-40-caffeine-lime-1-0-8" }),
    );

    expect(plan.caffeineMg).toBe(0);
    expect(plan.notes.join(" ")).toMatch(/more caffeine than 3 mg per kg/);
  });

  it("keeps bars off the climb on rides", () => {
    const base = input();
    const plan = solveFuelPlan(base, spec({ barId: "performance-bar-cocoa", barShare: 0.25 }));
    const bars = plan.intakes.filter((intake) => intake.role === "bar");

    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      for (const climb of base.climbs) {
        expect(bar.atSec < climb.startSec || bar.atSec > climb.endSec).toBe(true);
      }
    }
  });

  it("flags products the athlete doesn't have", () => {
    const plan = solveFuelPlan(input(), spec({ gelIds: ["made-up-gel"] }));

    expect(plan.issues).toContain("made-up-gel isn't one of your products.");
  });

  it("flags an hour packed above the cap", () => {
    const base = input();
    const plan = solveFuelPlan(base, spec({ drinkId: null, drinkShare: 0 }));
    const packed = {
      ...plan,
      intakes: plan.intakes.map((intake, index) => ({ ...intake, atSec: 3600 + index * 60 })),
    };

    expect(checkPlan(base, packed).join(" ")).toMatch(/More than 120 g of carbs in the hour/);
  });
});

describe("swapProduct", () => {
  it("swaps a gel for a chew and keeps the target", () => {
    const base = input();
    const plan = swapProduct(base, spec(), "gel-40-mango", "chew-40-lemon-1-0-8");

    expect(plan.intakes.some((intake) => intake.productId === "gel-40-mango")).toBe(false);
    expect(plan.intakes.some((intake) => intake.productId === "chew-40-lemon-1-0-8")).toBe(true);
    expect(Math.abs(plan.totalCarbsG - plan.targetCarbsG)).toBeLessThanOrEqual(40);
  });

  it("re-solves the bottles when the drink changes strength", () => {
    const base = input();
    const strong = solveFuelPlan(base, spec());
    const light = swapProduct(base, spec(), "power-carb", "fast-carb");

    expect(light.drink?.carbsPerBottleG).toBeLessThan(strong.drink?.carbsPerBottleG ?? 0);
    expect(light.items.find((item) => item.role === "gel")?.count).toBeGreaterThan(
      strong.items.find((item) => item.role === "gel")?.count ?? 0,
    );
  });

  it("replaces a product the athlete no longer has with one they do", () => {
    const owned = products.filter((product) => product.id !== "gel-40-mango");
    const base = input({ products: owned });
    const mango = products.find((product) => product.id === "gel-40-mango");
    const plan = swapProduct(base, spec(), "gel-40-mango", "gel-40-lemon", mango);

    expect(plan.issues).toEqual([]);
    expect(swapOptions(owned, "gel-40-mango", mango).some((p) => p.id === "gel-40-mango")).toBe(
      false,
    );
  });

  it("only offers products in the same role", () => {
    expect(swapOptions(products, "power-carb").every((product) => product.kind === "drink")).toBe(
      true,
    );
    expect(() => swapProduct(input(), spec(), "power-carb", "gel-40-lemon")).toThrow();
  });
});

describe("defaultProposals", () => {
  it("offers distinct product mixes, each a sound plan", () => {
    const base = input();
    const proposals = defaultProposals(base);
    const mixes = proposals.map((proposal) =>
      [proposal.drinkId, proposal.barId, ...proposal.gelIds].join(","),
    );

    expect(proposals).toHaveLength(3);
    expect(new Set(mixes).size).toBe(3);
    for (const proposal of proposals) {
      expect(solveFuelPlan(base, proposal).issues).toEqual([]);
    }
  });

  it("offers each mix once when the athlete has few products", () => {
    const few = products.filter((product) => product.id === "gel-40-mango");
    const proposals = defaultProposals(input({ products: few }));

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.gelIds).toEqual(["gel-40-mango"]);
  });

  it("leaves bars out on foot", () => {
    const proposals = defaultProposals(input({ carbTarget: 60 }, "Run"));

    expect(proposals.every((proposal) => proposal.barId == null)).toBe(true);
  });
});
