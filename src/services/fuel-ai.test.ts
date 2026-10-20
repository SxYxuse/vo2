import { describe, expect, it } from "vite-plus/test";

import { acceptProposals, applyPlacementReview, validateSimilarPicks } from "./fuel-ai.ts";
import { planningProducts } from "./fuel-catalog.ts";
import { defaultProposals, solveFuelPlan, type FuelPlanInput } from "./fuel-plan.ts";
import { buildRouteProfile, type GpxPoint } from "./route-gpx.ts";
import { predictRoute, type SimilarActivity } from "./route-prediction.ts";

function input(): FuelPlanInput {
  const points: GpxPoint[] = [];
  for (let d = 0; d <= 90_000; d += 25) {
    const ele = d < 60_000 ? 100 : d < 68_000 ? 100 + (d - 60_000) * 0.06 : 580;
    points.push({ lat: 45 + d / 111_195, lon: 6, ele });
  }
  const prediction = predictRoute({
    profile: buildRouteProfile({ name: null, points }),
    sportType: "Ride",
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
    products: planningProducts(),
  };
}

const proposal = {
  name: "Gels and Fast Carb",
  rationale: "Lighter drink, gels before the climb.",
  drinkId: "fast-carb",
  drinkShare: 0.4,
  gelIds: ["gel-40-peach"],
  barId: null,
  barShare: 0,
  caffeineId: null,
};

describe("validateSimilarPicks", () => {
  const candidates = [{ id: "a" }, { id: "b" }] as SimilarActivity[];

  it("keeps picks among the candidates", () => {
    expect(
      validateSimilarPicks({ picks: [{ id: "b", weight: 0.8, reason: "same climb" }] }, candidates),
    ).toEqual([{ id: "b", weight: 0.8 }]);
  });

  it("rejects an id that was not offered", () => {
    expect(
      validateSimilarPicks({ picks: [{ id: "z", weight: 1, reason: "" }] }, candidates),
    ).toBeNull();
  });
});

describe("acceptProposals", () => {
  it("keeps a valid proposal and tops up with the defaults", () => {
    const base = input();
    const accepted = acceptProposals({ proposals: [proposal] }, base, defaultProposals(base));

    expect(accepted).toHaveLength(3);
    expect(accepted[0]).toMatchObject({ id: "coach-1", drinkId: "fast-carb" });
  });

  it("drops proposals with unknown products or products in the wrong role", () => {
    const base = input();
    const accepted = acceptProposals(
      {
        proposals: [
          { ...proposal, gelIds: ["made-up-gel"] },
          { ...proposal, drinkId: "gel-40-mango" },
          // Caffeine products can't stand in as plain gels: their dose would go uncounted.
          { ...proposal, gelIds: ["gel-40-caffeine-matcha"] },
          // RACE CARB X states no carbs per serving.
          { ...proposal, drinkId: "race-carb-x" },
        ],
      },
      base,
      defaultProposals(base),
    );

    expect(accepted.some((spec) => spec.id.startsWith("coach-"))).toBe(false);
  });
});

describe("applyPlacementReview", () => {
  it("keeps a small move that breaks nothing", () => {
    const base = input();
    const plan = solveFuelPlan(base, defaultProposals(base)[1]!);
    const last = plan.intakes.length - 1;
    const reviewed = applyPlacementReview(base, plan, {
      shifts: [{ index: last, shiftMin: -5, reason: "before the final flat" }],
    });

    expect(reviewed.intakes.at(-1)?.atSec).toBe((plan.intakes[last]?.atSec ?? 0) - 300);
    expect(reviewed.intakes.at(-1)?.reason).toBe("before the final flat");
  });

  it("keeps the original when a move leaves a climb unfuelled", () => {
    const base = input();
    const plan = solveFuelPlan(base, defaultProposals(base)[1]!);
    const index = plan.intakes.findIndex((intake) =>
      intake.reason.startsWith("ready for the climb"),
    );
    const reviewed = applyPlacementReview(base, plan, {
      shifts: [{ index, shiftMin: 10, reason: "later" }],
    });

    expect(reviewed).toBe(plan);
  });

  it("keeps the original for an index that doesn't exist", () => {
    const base = input();
    const plan = solveFuelPlan(base, defaultProposals(base)[0]!);

    expect(
      applyPlacementReview(base, plan, { shifts: [{ index: 999, shiftMin: 5, reason: "" }] }),
    ).toBe(plan);
  });
});
