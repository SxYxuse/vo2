import { describe, expect, it } from "vite-plus/test";

import { sessionsAvailable, weekShapeBreaks, type RuleContext } from "./coach-plan-rules.ts";
import type { PlannedSession } from "./coach-plan.types.ts";
import type { WeekBudget } from "./coach-plan-budget.ts";
import { addDayKey } from "./day-key.ts";
import { seasonPhase, supportingRaceBlock } from "./season-phase.ts";
import { currentGoalWeight, seasonCopySchema, type Goal, type GoalEffort } from "./season.types.ts";

// The behaviour of a goal's priority and effort (ADR 0052), through the pure functions that
// decide it: the week's phase and load, the plan's rule checks, and the taper guard.

/** A Sunday main goal; its race week starts Monday 22 March, its taper on 15 March. */
const MAIN_DAY = "2027-03-28";
const RACE_WEEK = "2027-03-22";

let ids = 0;
function goal(date: string, effort: GoalEffort | null = null, distanceM = 42_195): Goal {
  ids += 1;
  return {
    id: `goal-${ids}`,
    name: effort ? `Supporting ${ids}` : `Main ${ids}`,
    sportType: "Run",
    date,
    distanceM,
    elevationGainM: null,
    priority: effort ? "B" : "A",
    effort,
  };
}

const main = goal(MAIN_DAY);
/** Six and five weeks before the main goal's race week: build weeks. */
const supportWeek = addDayKey(RACE_WEEK, -42);
const weekAfter = addDayKey(supportWeek, 7);
const supportDay = addDayKey(supportWeek, 6);

const phase = (goals: Goal[], week: string) => {
  const { kind, lighter, ramp, loadFactor } = seasonPhase(goals, week);
  return { kind, lighter, ramp, loadFactor };
};

describe("seasonPhase", () => {
  it("builds, tapers, and recovers for a main goal", () => {
    expect(phase([main], supportWeek)).toEqual({
      kind: "build",
      lighter: false,
      ramp: 7,
      loadFactor: null,
    });
    expect(phase([main], addDayKey(RACE_WEEK, -7))).toMatchObject({
      kind: "taper",
      loadFactor: 0.75,
    });
    expect(phase([main], RACE_WEEK)).toMatchObject({ kind: "race", loadFactor: 0.5 });
    expect(phase([main], addDayKey(RACE_WEEK, 7))).toMatchObject({
      kind: "recovery",
      loadFactor: 0.6,
    });
  });

  it("leaves the weeks around a race run for fun as they are", () => {
    const fun = goal(supportDay, "fun");
    for (const week of [addDayKey(supportWeek, -7), supportWeek, weekAfter]) {
      expect(phase([main, fun], week)).toEqual(phase([main], week));
    }
  });

  it("trims a steady race's week to 85 % and lightens the week after, in the main goal's phase", () => {
    const steady = goal(supportDay, "steady");
    expect(phase([main, steady], addDayKey(supportWeek, -7))).toEqual(
      phase([main], addDayKey(supportWeek, -7)),
    );
    expect(phase([main, steady], supportWeek)).toEqual({
      kind: "build",
      lighter: false,
      ramp: 0,
      loadFactor: 0.85,
    });
    expect(phase([main, steady], weekAfter)).toEqual({
      kind: "build",
      lighter: true,
      ramp: 0,
      loadFactor: 0.7,
    });
  });

  it("gives an all-out race the main goal's taper and a recovery week, but no build", () => {
    const allOut = goal(supportDay, "allOut");
    expect(phase([main, allOut], addDayKey(supportWeek, -14))).toEqual(
      phase([main], addDayKey(supportWeek, -14)),
    );
    expect(phase([main, allOut], addDayKey(supportWeek, -7))).toMatchObject({
      kind: "taper",
      loadFactor: 0.75,
    });
    expect(phase([main, allOut], supportWeek)).toMatchObject({ kind: "race", loadFactor: 0.5 });
    expect(phase([main, allOut], weekAfter)).toMatchObject({ kind: "recovery", loadFactor: 0.6 });
    expect(phase([main, allOut], addDayKey(weekAfter, 7))).toEqual(
      phase([main], addDayKey(weekAfter, 7)),
    );
  });

  it("never lets a supporting race lead: with no main goal ahead, fitness holds", () => {
    for (const effort of ["fun", "steady", "allOut"] as const) {
      const only = goal(supportDay, effort);
      expect(phase([only], addDayKey(supportWeek, -70)).kind).toBe("hold");
      expect(phase([only], addDayKey(supportWeek, -70)).ramp).toBe(0);
    }
    expect(phase([goal(supportDay, "steady")], supportWeek)).toMatchObject({
      kind: "hold",
      loadFactor: 0.85,
    });
  });

  it("builds toward each main goal in turn", () => {
    const later = goal(addDayKey(MAIN_DAY, 16 * 7));
    expect(phase([main, later], RACE_WEEK).kind).toBe("race");
    expect(phase([main, later], addDayKey(RACE_WEEK, 7)).kind).toBe("recovery");
    expect(phase([main, later], addDayKey(RACE_WEEK, 15 * 7)).kind).toBe("taper");
    expect(phase([main, later], addDayKey(RACE_WEEK, 16 * 7)).kind).toBe("race");
  });

  it("keeps the main goal's taper when a supporting race falls in it", () => {
    const steady = goal(addDayKey(MAIN_DAY, -8), "steady");
    expect(phase([main, steady], addDayKey(RACE_WEEK, -7))).toMatchObject({
      kind: "taper",
      loadFactor: 0.75,
    });
  });
});

describe("supportingRaceBlock", () => {
  const goals = [main];
  const block = (date: string) => supportingRaceBlock(goals, { date, priority: "B" });

  it("blocks a supporting race in the week before a main goal or in its race week", () => {
    expect(block(addDayKey(RACE_WEEK, -7))).toMatch(/taper for Main/);
    expect(block(addDayKey(RACE_WEEK, 2))).toMatch(/taper for Main/);
    expect(block(MAIN_DAY)).toMatch(/taper for Main/);
  });

  it("allows one before the taper, after the main goal, or of any length", () => {
    expect(block(addDayKey(RACE_WEEK, -8))).toBeNull();
    expect(block(addDayKey(MAIN_DAY, 1))).toBeNull();
    const longer = goal(addDayKey(RACE_WEEK, -14), "steady", 100_000);
    expect(supportingRaceBlock(goals, longer)).toBeNull();
  });

  it("never blocks a main goal, nor a goal against itself", () => {
    expect(supportingRaceBlock(goals, { date: addDayKey(MAIN_DAY, -2), priority: "A" })).toBeNull();
    expect(supportingRaceBlock(goals, { date: MAIN_DAY, priority: "B" }, [main.id])).toBeNull();
  });
});

describe("currentGoalWeight", () => {
  it("reads goals stored or copied before efforts", () => {
    expect(currentGoalWeight({ priority: "C" })).toEqual({ priority: "B", effort: "fun" });
    expect(currentGoalWeight({ priority: "B", effort: null })).toEqual({
      priority: "B",
      effort: "steady",
    });
    expect(currentGoalWeight({ priority: "B", effort: "allOut" })).toEqual({
      priority: "B",
      effort: "allOut",
    });
    expect(currentGoalWeight({ priority: "A", effort: null })).toEqual({
      priority: "A",
      effort: null,
    });
  });

  it("pastes a copied C goal as a race for fun", () => {
    const copied = { name: "10K", sportType: "Run", date: supportDay, priority: "C" };
    const parsed = seasonCopySchema.parse({
      vo2Season: 1,
      goals: [{ ...copied, distanceM: 10_000, elevationGainM: null }],
    });
    expect(parsed.goals[0]).toMatchObject({ priority: "B", effort: "fun" });
  });
});

describe("rules around a supporting race", () => {
  const week: WeekBudget = {
    weekStart: supportWeek,
    budgetKm: 40,
    budgetMinutes: 0,
    phase: "build",
    lighter: false,
    taper: false,
  };
  const ctx = (effort: "fun" | "steady"): RuleContext => ({
    availability: { runsPerWeek: 4, ridesPerWeek: 0 },
    weeks: [week],
    fromWeek: supportWeek,
    today: supportWeek,
    frozen: [],
    runs: [],
    rides: [],
    races: [{ weekStart: supportWeek, sport: "run", effort }],
    neighbours: [],
    easySecPerKm: 360,
    paces: null,
    racePaces: [],
  });
  const run = (kind: PlannedSession["kind"], distanceKm: number) =>
    ({
      id: `${kind}-${distanceKm}`,
      weekStart: supportWeek,
      sport: "run",
      kind,
      title: kind,
      why: "",
      blocks: [],
      distanceKm,
      minutes: distanceKm * 6,
    }) as PlannedSession;
  const quality = (breaks: { rule: string }[]) =>
    breaks.filter((item) => item.rule === "4. quality sessions");

  it("counts a race for fun as the week's easy run, not a quality one", () => {
    expect(sessionsAvailable(week, ctx("fun"), "run")).toBe(3);
    const sessions = [run("intervals", 8), run("tempo", 8), run("long", 12)];
    expect(quality(weekShapeBreaks(sessions, ctx("fun")))).toEqual([]);
  });

  it("keeps the other runs easy in a steady race's week", () => {
    expect(sessionsAvailable(week, ctx("steady"), "run")).toBe(4);
    const easy = [run("easy", 8), run("easy", 9), run("long", 12)];
    expect(quality(weekShapeBreaks(easy, ctx("steady")))).toEqual([]);
    const hard = [run("tempo", 8), run("easy", 9), run("long", 12)];
    expect(quality(weekShapeBreaks(hard, ctx("steady")))).toHaveLength(1);
  });
});
