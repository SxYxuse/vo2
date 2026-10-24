import { describe, expect, test } from "vite-plus/test";

import { planImpact } from "./plan-impact.ts";
import type { Goal } from "./season.types.ts";
import { addDayKey } from "./training-plan.types.ts";

/** A Monday. */
const WEEK = "2026-10-26";
const inWeeks = (weeks: number) => addDayKey(WEEK, weeks * 7 + 6);

function goal(id: string, date: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    name: id,
    sportType: "Ride",
    date,
    distanceM: 170_000,
    elevationGainM: 4_400,
    objective: "finishWell",
    priority: "A",
    ...overrides,
  };
}

const ventoux = goal("ventoux", inWeeks(32));

describe("planImpact", () => {
  test("nothing differs when Season matches the plan", () => {
    expect(planImpact([ventoux], [ventoux], WEEK, 5)).toMatchObject({
      differs: false,
      changes: [],
    });
  });

  test("an A goal after the current one changes no week of the block", () => {
    const etape = goal("etape", inWeeks(38), { objective: "perform" });
    const impact = planImpact([ventoux], [ventoux, etape], WEEK, 5);
    expect(impact.differs).toBe(true);
    expect(impact.added.map((g) => g.id)).toEqual(["etape"]);
    expect(impact.changes).toEqual([]);
  });

  test("a B goal inside the block changes the weeks around it", () => {
    const gravel = goal("gravel", inWeeks(7), { priority: "B", objective: "perform" });
    const impact = planImpact([ventoux], [ventoux, gravel], WEEK, 5);
    expect(impact.changes.length).toBeGreaterThan(0);
    expect(impact.changes.map((change) => change.weekStart)).toContain(addDayKey(WEEK, 7 * 7));
    expect(impact.changes.find((c) => c.weekStart === addDayKey(WEEK, 49))?.after).toContain(
      "gravel (B)",
    );
  });

  test("a new A goal before the current one reshapes the block", () => {
    const early = goal("early", inWeeks(10));
    const impact = planImpact([ventoux], [early, ventoux], WEEK, 5);
    expect(impact.changes.length).toBeGreaterThan(3);
  });

  test("changing the leading goal's objective changes its key sessions", () => {
    const perform = { ...ventoux, objective: "perform" as const };
    const impact = planImpact([ventoux], [perform], WEEK, 6);
    expect(impact.edited.map((g) => g.id)).toEqual(["ventoux"]);
    expect(impact.changes[0]?.before).toContain("key session");
    expect(impact.changes.length).toBeGreaterThan(0);
  });

  test("a first goal after holding fitness changes the coming weeks", () => {
    const impact = planImpact([], [goal("first", inWeeks(10))], WEEK, 5);
    expect(impact.changes[0]).toMatchObject({ weekStart: WEEK });
    expect(impact.changes[0]?.before).toContain("Hold");
  });

  test("a C goal to finish far away waits without asking", () => {
    const club = goal("club", inWeeks(20), { priority: "C", objective: "finish" });
    expect(planImpact([], [club], WEEK, 5).changes).toEqual([]);
  });

  test("deleting the leading goal reshapes the block", () => {
    const impact = planImpact([ventoux], [], WEEK, 5);
    expect(impact.removed.map((g) => g.id)).toEqual(["ventoux"]);
    expect(impact.changes.length).toBeGreaterThan(0);
  });
});
