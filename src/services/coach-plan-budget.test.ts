import { describe, expect, it } from "vite-plus/test";

import { weekBudgets, type SportDay } from "./coach-plan-budget.ts";
import { coachPlanGoal } from "./coach-plan.types.ts";
import { addDayKey } from "./day-key.ts";
import type { Goal } from "./season.types.ts";

const FIRST_WEEK = "2027-01-04";

const runs: SportDay[] = Array.from({ length: 12 }, (_, week) =>
  [0, 2, 4].map((day) => ({
    date: addDayKey(FIRST_WEEK, -7 * (week + 1) + day),
    km: 10,
    minutes: 55,
  })),
).flat();

describe("weekBudgets without a main goal", () => {
  it("builds base: running grows from the usual 30 km a week", () => {
    const budgets = weekBudgets({
      runs,
      rides: [],
      swims: [],
      goals: [],
      aGoal: null,
      firstWeek: FIRST_WEEK,
      count: 2,
      availability: { runsPerWeek: 3, ridesPerWeek: 0, swimsPerWeek: 0 },
      progression: {},
    });
    expect(budgets.map((week) => [week.phase, week.budgetKm])).toEqual([
      ["base", 30],
      ["base", 32],
    ]);
  });

  it("builds base for an A goal the plan can't build toward, such as a hike", () => {
    const hike: Goal = {
      id: "hike",
      name: "Hut to hut",
      sportType: "Hike",
      date: addDayKey(FIRST_WEEK, 7 * 22),
      distanceM: 40_000,
      elevationGainM: 2000,
      priority: "A",
      effort: null,
    };
    const budgets = weekBudgets({
      runs,
      rides: [],
      swims: [],
      goals: [hike],
      aGoal: coachPlanGoal([hike], FIRST_WEEK),
      firstWeek: FIRST_WEEK,
      count: 2,
      availability: { runsPerWeek: 3, ridesPerWeek: 0, swimsPerWeek: 0 },
      progression: {},
    });
    expect(budgets.map((week) => [week.phase, week.budgetKm])).toEqual([
      ["base", 30],
      ["base", 32],
    ]);
  });
});
