import { describe, expect, test } from "vite-plus/test";

import { blendShares, seasonPhase } from "./season-phase.ts";
import { addDayKey } from "./training-plan.types.ts";
import type { Goal } from "./season.types.ts";

/** A Monday. */
const WEEK = "2027-01-04";

function goal(id: string, date: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    name: id,
    sportType: "Run",
    date,
    distanceM: 21_100,
    elevationGainM: null,
    objective: "finishWell",
    main: false,
    ...overrides,
  };
}

/** A goal `weeks` weeks after this Monday, on its Sunday. */
const inWeeks = (weeks: number) => addDayKey(WEEK, weeks * 7 + 6);

const kindFor = (goals: Goal[], weekStart = WEEK) => seasonPhase(goals, weekStart).kind;

describe("seasonPhase", () => {
  test("holds fitness with no goal ahead", () => {
    expect(seasonPhase([], WEEK)).toMatchObject({ kind: "hold", ramp: 0, anchor: [] });
  });

  test("walks base, build, peak, taper, race week toward a goal", () => {
    const kinds = [20, 13, 12, 4, 3, 2, 1, 0].map((weeks) => kindFor([goal("a", inWeeks(weeks))]));
    expect(kinds).toEqual(["base", "base", "build", "build", "peak", "peak", "taper", "race"]);
  });

  test("the objective sets the ramp", () => {
    const ramp = (objective: Goal["objective"]) =>
      seasonPhase([goal("a", inWeeks(8), { objective })], WEEK).ramp;
    expect([ramp("finish"), ramp("finishWell"), ramp("perform")]).toEqual([3, 5, 8]);
  });

  test("taper and race week cut volume and keep one key session", () => {
    expect(seasonPhase([goal("a", inWeeks(1))], WEEK)).toMatchObject({
      loadFactor: 0.75,
      maxKeySessions: 1,
    });
    expect(seasonPhase([goal("a", inWeeks(0))], WEEK)).toMatchObject({
      loadFactor: 0.5,
      maxKeySessions: 1,
    });
  });

  test("the week after a main goal is recovery, with no key sessions", () => {
    const raced = goal("a", addDayKey(WEEK, -1));
    expect(seasonPhase([raced], WEEK)).toMatchObject({ kind: "recovery", maxKeySessions: 0 });
    expect(kindFor([raced, goal("b", inWeeks(10))])).toBe("recovery");
    expect(kindFor([raced], addDayKey(WEEK, 7))).toBe("hold");
  });

  test("a close next goal holds fitness instead of a full build", () => {
    const raced = goal("a", addDayKey(WEEK, -8));
    expect(kindFor([raced, goal("b", inWeeks(5))])).toBe("maintain");
    expect(kindFor([raced, goal("b", inWeeks(8))])).toBe("build");
  });

  test("works toward the main goal of a cluster, with a short taper for a tune-up", () => {
    const tuneUp = goal("10k", inWeeks(0), { distanceM: 10_000 });
    const marathon = goal("marathon", inWeeks(3), { distanceM: 42_195 });
    const phase = seasonPhase([tuneUp, marathon], WEEK);
    expect(phase.anchor.map((g) => g.id)).toEqual(["marathon"]);
    expect(phase).toMatchObject({ kind: "peak", ramp: 0, loadFactor: 0.85, maxKeySessions: 1 });
    expect(phase.tuneUp.map((g) => g.id)).toEqual(["10k"]);
  });

  test("a tune-up already done brings no recovery week", () => {
    const tuneUp = goal("10k", addDayKey(WEEK, -1), { distanceM: 10_000 });
    const marathon = goal("marathon", inWeeks(2), { distanceM: 42_195 });
    expect(kindFor([tuneUp, marathon])).toBe("peak");
  });

  test("a same-day multisport goal takes the most demanding objective", () => {
    const phase = seasonPhase(
      [
        goal("swim", inWeeks(6), { sportType: "Swim", objective: "finish" }),
        goal("run", inWeeks(6), { objective: "perform" }),
      ],
      WEEK,
    );
    expect(phase.objective).toBe("perform");
    expect(phase.anchor).toHaveLength(2);
  });

  test("leans the sport split toward the goal's sport from build on", () => {
    const ride = goal("ride", inWeeks(6), { sportType: "Ride", distanceM: 100_000 });
    const phase = seasonPhase([ride], WEEK);
    expect(phase.goalShares).toEqual({ running: 0, cycling: 1, other: 0 });
    expect(blendShares({ running: 1, cycling: 0, other: 0 }, phase)).toEqual({
      running: expect.closeTo(0.3),
      cycling: expect.closeTo(0.7),
      other: 0,
    });
  });

  test("base spreads time over every upcoming goal's sport", () => {
    const phase = seasonPhase(
      [
        goal("trail", inWeeks(16), { distanceM: 20_000 }),
        goal("fondo", inWeeks(30), { sportType: "Ride", distanceM: 50_000 }),
      ],
      WEEK,
    );
    expect(phase.kind).toBe("base");
    expect(phase.goalShares).toEqual({ running: 0.5, cycling: 0.5, other: 0 });
    expect(phase.goalWeight).toBe(0.5);
  });
});
