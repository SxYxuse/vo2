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

/** 140 km: climbs of 112 m, 515 m, 114 m, then 895 m from km 99, like a mountain stage. */
function stageInput(): FuelPlanInput {
  const segments: [number, number][] = [
    [15_000, 0],
    [3000, 0.04],
    [2000, -0.04],
    [20_000, 0.002],
    [8000, 0.065],
    [8000, -0.06],
    [25_000, 0],
    [1500, 0.08],
    [1500, -0.07],
    [15_000, 0.003],
    [12_000, 0.075],
    [12_000, -0.07],
    [17_000, 0],
  ];
  const points: GpxPoint[] = [];
  let d = 0;
  let ele = 150;
  for (const [length, grade] of segments) {
    for (let step = 0; step < length; step += 25) {
      d += 25;
      ele += 25 * grade;
      points.push({ lat: 45 + d / 111_195, lon: 6, ele });
    }
  }
  const prediction = predictRoute({
    profile: buildRouteProfile({ name: null, points }),
    sportType: "Ride",
    history: [],
    now: new Date("2026-10-20T08:00:00Z"),
    form: { ctl: null, tsb: null },
    bodyWeightKg: 66,
  });
  return {
    sportGroup: prediction.sportGroup,
    elapsedSec: prediction.elapsedSec,
    steps: prediction.steps,
    climbs: prediction.climbs,
    carbTarget: 100,
    bottles: { count: 2, ml: 750 },
    bodyWeightKg: 66,
    products,
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
    solidId: "jelly-40-neutral-1-0-8",
    solidShare: 0.2,
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

  it("mixes a weak drink stronger when the bottles are too few for the share", () => {
    const plan = solveFuelPlan(
      input({ carbTarget: 100, bottles: { count: 2, ml: 750 } }),
      spec({ drinkId: "fast-carb", drinkShare: 0.5 }),
    );

    // FAST CARB at the store's strength is about 60 g a 750 ml bottle; POWER CARB's is 122.
    expect(plan.drink?.bottles).toBe(2);
    expect(plan.drink?.carbsPerBottleG).toBeGreaterThan(80);
    expect(plan.drink?.carbsPerBottleG).toBeLessThanOrEqual(0.165 * 750);
  });

  it("fills only the bottles the share needs and keeps the rest as water", () => {
    const plan = solveFuelPlan(
      input({ bottles: { count: 2, ml: 750 } }),
      spec({ drinkShare: 0.2 }),
    );

    expect(plan.drink?.bottles).toBe(1);
    expect(plan.waterBottles).toBe(1);
    // POWER CARB: 81.4 g in 85 g of powder.
    expect(plan.drink?.powderPerBottleG).toBe(
      Math.round(((plan.drink?.carbsPerBottleG ?? 0) * 85) / 81.4),
    );
  });

  it("puts the mix in the bottles the athlete chose and keeps the rest as water", () => {
    const plan = solveFuelPlan(
      input({ carbTarget: 100, bottles: { count: 2, ml: 750, mix: 1 } }),
      spec({ drinkId: "power-carb", drinkShare: 0.4 }),
    );

    // One strong bottle: more of the drink's share than it can hold moves to food.
    expect(plan.drink?.bottles).toBe(1);
    expect(plan.waterBottles).toBe(1);
    expect(plan.drink?.carbsPerBottleG).toBeCloseTo(0.165 * 750, 0);
    expect(plan.issues).toEqual([]);
  });

  it("caps drink at the bottles carried and moves the rest to gels", () => {
    const plan = solveFuelPlan(
      input({ bottles: { count: 1, ml: 500 } }),
      spec({ drinkShare: 0.9 }),
    );

    expect(plan.drink?.bottles).toBe(1);
    expect(plan.drink?.carbsPerBottleG).toBe(82.5);
    expect(plan.notes.join(" ")).toMatch(/bottles cover 83 g/);
    expect(Math.abs(plan.totalCarbsG - plan.targetCarbsG)).toBeLessThanOrEqual(40);
  });

  it("spreads the drink as a sip every 20 minutes over the whole session", () => {
    const base = input();
    const plan = solveFuelPlan(base, spec());
    const sips = plan.intakes.filter((intake) => intake.role === "drink");
    const gaps = sips.slice(1).map((sip, index) => sip.atSec - (sips[index]?.atSec ?? 0));

    expect(gaps.every((gap) => gap === 20 * 60)).toBe(true);
    expect(sips.at(-1)?.atSec).toBeGreaterThan(base.elapsedSec - 40 * 60);
    expect(sips.reduce((sum, sip) => sum + sip.carbsG, 0)).toBeCloseTo(
      (plan.drink?.bottles ?? 0) * (plan.drink?.carbsPerBottleG ?? 0),
      0,
    );
  });

  it("asks for a refill when the bottles are too little fluid for the session", () => {
    const short = solveFuelPlan(input({ bottles: { count: 1, ml: 500 } }), spec());
    const enough = solveFuelPlan(input({ bottles: { count: 3, ml: 750 } }), spec());

    expect(short.fluid.mlPerHour).toBeLessThan(400);
    expect(short.fluid.refill?.atSec).toBe(3600);
    expect(short.fluid.refill?.km).toBeGreaterThan(0);
    expect(enough.fluid.refill).toBeNull();
  });

  it("plans water in the bottles left over", () => {
    const plan = solveFuelPlan(input(), spec({ drinkId: null, drinkShare: 0 }));

    expect(plan.drink).toBeNull();
    expect(plan.waterBottles).toBe(2);
    expect(plan.intakes.every((intake) => intake.withFluid)).toBe(true);
  });

  it("has a gel ready at the start of each climb", () => {
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

  it("keeps the caffeine for the last climb when earlier climbs take gels", () => {
    // 140 km with four climbs, the longest last: the climb gels used to fill caffeine's hour.
    const base = stageInput();
    const plan = solveFuelPlan(
      base,
      spec({
        drinkId: "fast-carb-lemon-1-0-8",
        drinkShare: 0.4,
        gelIds: ["gel-40-apple"],
        solidId: "jelly-40-rhubarb-1-0-8",
        caffeineId: "gel-40-caffeine-lime-1-0-8",
      }),
    );
    const last = base.climbs.at(-1)!;
    const caffeine = plan.intakes.find((intake) => intake.role === "caffeine");

    expect(base.climbs.length).toBeGreaterThanOrEqual(3);
    expect(caffeine?.caffeineMg).toBe(150);
    expect(caffeine?.readyAtSec).toBeGreaterThanOrEqual(last.startSec - 20 * 60);
    expect(caffeine?.readyAtSec).toBeLessThanOrEqual(last.startSec + 10 * 60);
    expect(plan.issues).toEqual([]);
    expect(plan.notes.join(" ")).not.toMatch(/didn't fit/);
    expect(plan.achievedGph).toBeGreaterThanOrEqual(95);
  });

  it("keeps one solid in every plan even when the hours are full", () => {
    // Heavy sips and a gel before each of four climbs leave no free slot for a bar.
    const plan = solveFuelPlan(
      stageInput(),
      spec({
        drinkId: "power-carb-sour-cherry-1-0-8",
        drinkShare: 0.5,
        gelIds: ["gel-40-neutral-1-0-8"],
        solidId: "performance-bar-cocoa",
        solidShare: 0.2,
        caffeineId: "gel-40-caffeine-lime-1-0-8",
      }),
    );

    expect(plan.intakes.some((intake) => intake.role === "bar")).toBe(true);
    expect(plan.issues).toEqual([]);
  });

  it("keeps jelly and bars off every climb on rides", () => {
    const base = stageInput();
    for (const solidId of ["jelly-40-rhubarb-1-0-8", "performance-bar-cocoa"]) {
      const plan = solveFuelPlan(base, spec({ solidId, solidShare: 0.3 }));
      const solids = plan.intakes.filter(
        (intake) => intake.role === "jelly" || intake.role === "bar",
      );

      expect(solids.length).toBeGreaterThan(0);
      for (const solid of solids) {
        for (const climb of base.climbs) {
          expect(solid.atSec < climb.startSec || solid.atSec > climb.endSec).toBe(true);
        }
      }
    }
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
    const plan = solveFuelPlan(base, spec({ solidId: "performance-bar-cocoa", solidShare: 0.25 }));
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
  it("swaps a gel for another gel and keeps the target", () => {
    const base = input();
    const plan = swapProduct(base, spec(), "gel-40-mango", "gel-40-lemon");

    expect(plan.intakes.some((intake) => intake.productId === "gel-40-mango")).toBe(false);
    expect(plan.intakes.some((intake) => intake.productId === "gel-40-lemon")).toBe(true);
    expect(Math.abs(plan.totalCarbsG - plan.targetCarbsG)).toBeLessThanOrEqual(40);
  });

  it("swaps jelly for a bar", () => {
    const base = input();
    const plan = swapProduct(base, spec(), "jelly-40-neutral-1-0-8", "performance-bar-cocoa");

    expect(plan.intakes.some((intake) => intake.productId === "jelly-40-neutral-1-0-8")).toBe(
      false,
    );
    expect(plan.intakes.some((intake) => intake.productId === "performance-bar-cocoa")).toBe(true);
  });

  it("re-solves the bottles when the drink changes", () => {
    const base = input();
    const strong = solveFuelPlan(base, spec());
    const light = swapProduct(base, spec(), "power-carb", "fast-carb");

    expect(light.drink?.productId).toBe("fast-carb");
    // FAST CARB has half POWER CARB's carbs per gram, so the same carbs take more powder.
    expect(light.drink?.powderPerBottleG).toBeGreaterThan(strong.drink?.powderPerBottleG ?? 0);
    expect(Math.abs(light.totalCarbsG - light.targetCarbsG)).toBeLessThanOrEqual(40);
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
  it("offers distinct mixes, each a drink, one solid, and gels", () => {
    const base = input();
    const proposals = defaultProposals(base);
    const mixes = proposals.map((proposal) =>
      [proposal.drinkId, proposal.solidId, ...proposal.gelIds].join(","),
    );

    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mixes).size).toBe(proposals.length);
    for (const proposal of proposals) {
      expect(proposal.drinkId).toBeTruthy();
      expect(proposal.solidId).toBeTruthy();
      expect(proposal.gelIds.length).toBeGreaterThan(0);
      expect(solveFuelPlan(base, proposal).issues).toEqual([]);
    }
    const drinkLines = new Set(
      proposals.map(
        (proposal) => products.find((product) => product.id === proposal.drinkId)?.line,
      ),
    );
    expect(
      drinkLines.has("SLOW CARB") || drinkLines.has("FAST CARB") || drinkLines.has("POWER CARB"),
    ).toBe(true);
  });

  it("rotates the athlete's gels and splits the carbs differently in each proposal", () => {
    const owned = products.filter((product) =>
      [
        "fast-carb-lemon-1-0-8",
        "jelly-40-rhubarb-1-0-8",
        "gel-40-apple",
        "gel-40-neutral-1-0-8",
      ].includes(product.id),
    );
    const proposals = defaultProposals(input({ products: owned }));

    expect(proposals).toHaveLength(3);
    for (const proposal of proposals) {
      expect([...proposal.gelIds].sort()).toEqual(["gel-40-apple", "gel-40-neutral-1-0-8"]);
    }
    expect(new Set(proposals.map((proposal) => proposal.drinkShare)).size).toBe(3);
  });

  it("offers each mix once when the athlete has few products", () => {
    const few = products.filter((product) => product.id === "gel-40-mango");
    const proposals = defaultProposals(input({ products: few }));

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.gelIds).toEqual(["gel-40-mango"]);
  });

  it("leaves bars out on foot", () => {
    const proposals = defaultProposals(input({ carbTarget: 60 }, "Run"));
    const solidKinds = proposals.map(
      (proposal) => products.find((product) => product.id === proposal.solidId)?.kind,
    );

    expect(solidKinds.every((kind) => kind !== "bar")).toBe(true);
    expect(proposals.every((proposal) => proposal.drinkId && proposal.gelIds.length > 0)).toBe(
      true,
    );
  });
});
