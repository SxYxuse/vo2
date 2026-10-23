import { describe, expect, it } from "vite-plus/test";

import { seasonPhase } from "./season-phase.ts";
import type { Goal } from "./season.types.ts";
import type { TrainingPlan } from "./training-plan.types.ts";
import {
  acceptProposedPlan,
  noteFrom,
  planRecommendation,
  planWeek,
  withParsedConstraints,
  type CoachNote,
  type DayConstraint,
  type ProposedPlan,
  type WeekPlan,
} from "./week-plan.ts";
import { summarizeWeek, type WeekActivity, type WeekTargetData } from "./week-target.ts";

const WEEK_START = "2026-10-19";
const WEDNESDAY = "2026-10-21";
const NOW = new Date("2026-10-21T08:00:00Z");

const PLAN: TrainingPlan = {
  targetMode: "manual",
  // 3 key sessions out of 6, 6 hours, rest on Monday.
  weekMix: { minSessions: 6, maxSessions: 6, keyShare: 50, doubleDays: 0 },
  keySessionSports: {},
  targetWeeklyHours: 6,
  preferredRestWeekday: 1,
  timeZone: "UTC",
};

const COLLECTORS = { heartRate: true, power: false, powerPartial: false };

function week(
  overrides: Partial<WeekTargetData> & { plan?: TrainingPlan } = {},
): WeekTargetData & { plan: TrainingPlan } {
  return {
    signedIn: true,
    plan: PLAN,
    today: WEDNESDAY,
    weekStart: WEEK_START,
    activities: [],
    history: [],
    weekStartFitness: { ctl: 3, atl: 3 },
    fitness: { ctl: 3, atl: 3 },
    collectors: {
      running: COLLECTORS,
      cycling: COLLECTORS,
      swimming: COLLECTORS,
      walking: COLLECTORS,
    },
    season: { ...seasonPhase([], WEEK_START), kind: "build", ramp: 5, rotation: "steady" },
    anchors: {
      ftpWatts: null,
      heartRate: {
        cycling: { maxHr: 190, lthr: 160 },
        running: { maxHr: 195, lthr: 170 },
        swimming: { maxHr: 180, lthr: 150 },
        walking: { maxHr: null, lthr: null },
      },
    },
    ...overrides,
  };
}

function plan(data = week(), constraints: DayConstraint[] = []) {
  return planWeek(data, summarizeWeek(data), constraints, NOW);
}

const day = (result: WeekPlan, date: string) => result.days.find((item) => item.date === date)!;

describe("planWeek", () => {
  it("lays out today through Sunday, key sessions on separate days and never hard back to back", () => {
    const result = plan();
    expect(result.days.map((item) => item.date)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    const keys = result.days.filter((item) => item.kind === "key");
    expect(new Set(keys.map((item) => item.keySessionId)).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
    const total = result.days.reduce((sum, item) => sum + item.minutes, 0);
    expect(total).toBeLessThanOrEqual(summarizeWeek(week()).remainingMinutes + 15);
  });

  it("starts tomorrow once today has an activity", () => {
    const done: WeekActivity = {
      id: "a",
      title: "Ride",
      date: WEDNESDAY,
      sportType: "Ride",
      family: "cycling",
      minutes: 60,
      load: 50,
      hardMinutes: 0,
      hardSource: "heartRate",
      zoneMinutes: null,
    };
    expect(plan(week({ activities: [done] })).days[0]!.date).toBe("2026-10-22");
  });

  it("keeps the athlete's day off, time cap, indoor and easy days", () => {
    const result = plan(week(), [
      { date: "2026-10-21", kind: "off", minutes: null },
      { date: "2026-10-22", kind: "short", minutes: 40 },
      { date: "2026-10-22", kind: "indoor", minutes: null },
      { date: "2026-10-23", kind: "easy", minutes: null },
    ]);
    expect(day(result, "2026-10-21")).toMatchObject({ kind: "rest", minutes: 0 });
    expect(day(result, "2026-10-22").minutes).toBeLessThanOrEqual(40);
    expect(day(result, "2026-10-22").indoor).toBe(true);
    expect(day(result, "2026-10-23").kind).not.toBe("key");
  });

  it("the day before a goal is an opener and the goal's day is the race", () => {
    const goal: Goal = {
      id: "g",
      name: "Gran Fondo",
      sportType: "Ride",
      date: "2026-10-25",
      distanceM: 160_000,
      elevationGainM: 2_000,
      objective: "perform",
      priority: "A",
    };
    const result = plan(week({ season: seasonPhase([goal], WEEK_START) }));
    expect(day(result, "2026-10-24")).toMatchObject({ kind: "key", keySessionId: "opener" });
    expect(day(result, "2026-10-25")).toMatchObject({ kind: "race", sport: "cycling" });
  });
});

describe("today from the plan", () => {
  it("the Today pick follows the planned day", () => {
    const data = week();
    const summary = summarizeWeek(data);
    const result = plan(data, [{ date: WEDNESDAY, kind: "off", minutes: null }]);
    const rest = planRecommendation(data, summary, day(result, WEDNESDAY));
    expect(rest).toMatchObject({ kind: "rest", description: "Take the day off." });
    const key = result.days.find((item) => item.kind === "key")!;
    const pick = planRecommendation(data, summary, key);
    expect(pick).toMatchObject({ kind: "key" });
    expect(pick!.parts[0]!.minutes).toBeLessThanOrEqual(key.minutes + 10);
  });

  it("shortens the long session to the time the week has left", () => {
    const done: WeekActivity = {
      id: "big",
      title: "Ride",
      date: "2026-10-20",
      sportType: "Ride",
      family: "cycling",
      minutes: 300,
      load: 250,
      hardMinutes: 0,
      hardSource: "heartRate",
      zoneMinutes: null,
    };
    const data = week({ activities: [done] });
    const result = plan(data);
    const total = result.days.reduce((sum, item) => sum + item.minutes, 0);
    expect(total).toBeLessThanOrEqual(Math.max(45, summarizeWeek(data).remainingMinutes) + 45);
  });
});

describe("acceptProposedPlan", () => {
  const data = week();
  const summary = summarizeWeek(data);
  const base = planWeek(data, summary, [], NOW);
  const openKeys = new Map(
    summary.keySessions.filter((status) => !status.done).map((s) => [s.session.id, s.session]),
  );
  const rules = (constraints: DayConstraint[] = []) => ({
    base,
    constraints,
    openKeys,
    remainingMinutes: summary.remainingMinutes,
    hardBefore: false,
  });
  const echo = (): ProposedPlan => ({
    constraints: [],
    note: "Moved things around.",
    days: base.days.map(({ date, kind, sport, minutes, keySessionId, indoor, note }) => ({
      date,
      kind: kind === "race" ? "rest" : kind,
      sport,
      minutes,
      keySessionId,
      indoor,
      note,
    })),
  });

  it("takes a layout that keeps every rule, with the coach's note", () => {
    const { plan: accepted, problems } = acceptProposedPlan(echo(), rules(), NOW);
    expect(problems).toEqual([]);
    expect(accepted).toMatchObject({ source: "coach", note: "Moved things around." });
  });

  it("drops a layout with an invented key session", () => {
    const raw = echo();
    const keyDay = raw.days.find((item) => item.kind === "key")!;
    keyDay.keySessionId = "made-up";
    expect(acceptProposedPlan(raw, rules(), NOW).plan).toBeNull();
  });

  it("drops a layout that trains on a day off or overfills the week", () => {
    const off = echo();
    off.days[0] = { ...off.days[0]!, kind: "easy", sport: "cycling", minutes: 60 };
    expect(
      acceptProposedPlan(off, rules([{ date: off.days[0]!.date, kind: "off", minutes: null }]), NOW)
        .plan,
    ).toBeNull();

    const greedy = echo();
    greedy.days = greedy.days.map((item) => ({
      ...item,
      kind: "easy",
      sport: "cycling",
      minutes: 300,
      keySessionId: null,
    }));
    expect(acceptProposedPlan(greedy, rules(), NOW).plan).toBeNull();
  });

  it("drops a layout that leaves the week's time unused", () => {
    const lazy = echo();
    lazy.days = lazy.days.map((item) => ({
      ...item,
      kind: "rest",
      sport: null,
      minutes: 0,
      keySessionId: null,
    }));
    expect(acceptProposedPlan(lazy, rules(), NOW).problems).toContain(
      "leaves most of the week's time unused",
    );
  });

  it("drops hard key sessions on consecutive days", () => {
    const raw = echo();
    const hard = [...openKeys.values()].filter(
      (session) => session.kind !== "long" && session.zone !== "z2",
    );
    if (hard.length < 2) return;
    raw.days[0] = {
      ...raw.days[0]!,
      kind: "key",
      sport: "cycling",
      minutes: 60,
      keySessionId: hard[0]!.id,
    };
    raw.days[1] = {
      ...raw.days[1]!,
      kind: "key",
      sport: "cycling",
      minutes: 60,
      keySessionId: hard[1]!.id,
    };
    raw.days = raw.days.map((item, index) =>
      index > 1 && item.keySessionId ? { ...item, kind: "easy", keySessionId: null } : item,
    );
    expect(acceptProposedPlan(raw, rules(), NOW).problems.join()).toContain("back to back");
  });
});

describe("coach notes", () => {
  it("a quick choice is read at once; free text waits for the model", () => {
    const quick = noteFrom({ date: WEDNESDAY, kind: "short", minutes: 40, text: "" }, "n1", NOW);
    expect(quick).toMatchObject({
      parsed: true,
      text: "Short on time (40 min)",
      constraints: [{ date: WEDNESDAY, kind: "short", minutes: 40 }],
    });
    const text = noteFrom(
      { date: WEDNESDAY, kind: null, minutes: null, text: "Storm all day" },
      "n2",
      NOW,
    );
    expect(text).toMatchObject({ parsed: false, constraints: [] });
  });

  it("hands what the model read to the notes waiting for it, without repeats", () => {
    const notes: CoachNote[] = [
      noteFrom({ date: WEDNESDAY, kind: "off", minutes: null, text: "" }, "a", NOW),
      noteFrom({ date: WEDNESDAY, kind: null, minutes: null, text: "Away this weekend" }, "b", NOW),
    ];
    const read: DayConstraint[] = [
      { date: WEDNESDAY, kind: "off", minutes: null },
      { date: "2026-10-24", kind: "off", minutes: null },
      { date: "2026-10-25", kind: "off", minutes: null },
    ];
    const updated = withParsedConstraints(notes, read);
    expect(updated[0]!.constraints).toHaveLength(1);
    expect(updated[1]).toMatchObject({ parsed: true });
    expect(updated[1]!.constraints.map((item) => item.date)).toEqual(["2026-10-24", "2026-10-25"]);
  });
});
