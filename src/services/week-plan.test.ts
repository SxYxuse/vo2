import { describe, expect, it } from "vite-plus/test";

import { seasonPhase, type SeasonPhase } from "./season-phase.ts";
import type { Goal } from "./season.types.ts";
import { addDayKey, type TrainingPlan } from "./training-plan.types.ts";
import {
  matchWeek,
  noteFrom,
  planWeek,
  planWeeksAhead,
  projectPlan,
  replanSignals,
  sessionRecommendation,
  withParsedConstraints,
  type CoachNote,
  type DayConstraint,
  type PlannedSession,
  type WeekPlan,
} from "./week-plan.ts";
import { summarizeWeek, type WeekActivity, type WeekTargetData } from "./week-target.ts";

const MONDAY = "2026-10-19";
const WEDNESDAY = "2026-10-21";
const SATURDAY = "2026-10-24";
const SUNDAY = "2026-10-25";
const NOW = new Date("2026-10-19T08:00:00Z");

/** Monday and Friday off, long session on Saturday. */
const PLAN: TrainingPlan = {
  restWeekdays: [1, 5],
  longWeekday: 6,
  doubleDays: 0,
  sports: ["cycling", "running"],
  goals: [],
  startWeek: MONDAY,
  baselineMinutes: null,
  keySessionSports: {},
  timeZone: "UTC",
};

function goal(date: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id: `g-${date}`,
    name: "Gran Fondo",
    sportType: "Ride",
    date,
    distanceM: 120_000,
    elevationGainM: 1500,
    objective: "finishWell",
    priority: "A",
    ...overrides,
  };
}

const LEADING = goal("2027-03-07", { objective: "perform", id: "lead" });

/** A build week toward a goal raced to perform: three key sessions. */
const BUILD: SeasonPhase = {
  ...seasonPhase([], MONDAY),
  kind: "build",
  ramp: 5,
  rotation: "steady",
  anchor: [LEADING],
  objective: "perform",
};

const COLLECTORS = { heartRate: true, power: false, powerPartial: false };

function activity(overrides: Partial<WeekActivity>): WeekActivity {
  return {
    id: "a",
    title: "Ride",
    date: MONDAY,
    sportType: "Ride",
    family: "cycling",
    minutes: 60,
    load: 50,
    hardMinutes: 0,
    hardSource: "heartRate",
    zoneMinutes: null,
    ...overrides,
  };
}

function week(
  overrides: Partial<WeekTargetData> & { plan?: TrainingPlan } = {},
): WeekTargetData & { plan: TrainingPlan } {
  return {
    signedIn: true,
    plan: PLAN,
    today: MONDAY,
    weekStart: MONDAY,
    activities: [],
    history: [],
    weekStartFitness: { ctl: 50, atl: 50 },
    fitness: { ctl: 50, atl: 50 },
    collectors: {
      running: COLLECTORS,
      cycling: COLLECTORS,
      swimming: COLLECTORS,
      walking: COLLECTORS,
    },
    season: BUILD,
    nearbyGoals: [],
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

function plan(data = week(), constraints: DayConstraint[] = [], previous: WeekPlan | null = null) {
  return planWeek({ data, summary: summarizeWeek(data), constraints, previous, now: NOW });
}

const on = (result: WeekPlan, date: string) => result.days.find((day) => day.date === date)!;
const sessions = (result: WeekPlan): (PlannedSession & { date: string })[] =>
  result.days.flatMap((day) => day.sessions.map((item) => ({ ...item, date: day.date })));
const keyDates = (result: WeekPlan) =>
  sessions(result)
    .filter((item) => item.kind === "key")
    .map((item) => item.date);
const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

describe("planWeek", () => {
  it("plans Monday to Sunday, nothing on rest days", () => {
    const result = plan();
    expect(result.days.map((day) => day.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => addDayKey(MONDAY, index)),
    );
    expect(on(result, MONDAY)).toMatchObject({ rest: true, sessions: [] });
    expect(on(result, "2026-10-23")).toMatchObject({ rest: true, sessions: [] });
  });

  it("puts the long session on the long session day and spreads the hard ones apart", () => {
    const result = plan();
    const long = sessions(result).find(
      (item) => item.kind === "key" && item.keySessionId?.endsWith("long"),
    );
    expect(long?.date).toBe(SATURDAY);
    const hard = sessions(result).filter(
      (item) => item.kind === "key" && !item.keySessionId?.endsWith("long"),
    );
    expect(hard.length).toBeGreaterThan(0);
    for (const a of hard) {
      for (const b of hard) if (a !== b) expect(dayGap(a.date, b.date)).toBeGreaterThan(1);
    }
  });

  it("uses the closest training day when the long session day is taken by rest", () => {
    const result = plan(week({ plan: { ...PLAN, restWeekdays: [1, 6], longWeekday: 0 } }));
    const long = sessions(result).find((item) => item.keySessionId?.endsWith("long"));
    expect(long?.date).toBe(SUNDAY);
  });

  it("fills the free training days with easy sessions within the week's time", () => {
    const data = week();
    const result = plan(data);
    const total = sessions(result).reduce((sum, item) => sum + item.minutes, 0);
    expect(total).toBeLessThanOrEqual(summarizeWeek(data).remainingMinutes + 15);
    expect(sessions(result).some((item) => item.kind === "easy")).toBe(true);
    for (const item of sessions(result).filter((entry) => entry.kind === "easy")) {
      expect(item.minutes).toBeGreaterThanOrEqual(item.sport === "cycling" ? 45 : 30);
    }
  });

  it("plans one session a day without double-session days", () => {
    for (const day of plan().days) expect(day.sessions.length).toBeLessThanOrEqual(1);
  });

  it("adds easy second sessions when the week's time does not fit in one a day", () => {
    const busy = week({
      plan: { ...PLAN, restWeekdays: [1, 2, 3, 5], doubleDays: 2, longWeekday: 6 },
      weekStartFitness: { ctl: 90, atl: 90 },
      fitness: { ctl: 90, atl: 90 },
    });
    const result = plan(busy);
    const seconds = sessions(result).filter((item) => item.second);
    expect(seconds.length).toBeGreaterThan(0);
    expect(seconds.length).toBeLessThanOrEqual(2);
    for (const item of seconds) {
      expect(item.kind).toBe("easy");
      expect(item.date).not.toBe(SATURDAY);
      const day = on(result, item.date);
      expect(day.sessions.some((other) => other.kind === "key")).toBe(false);
    }
  });

  it("keeps a sport the athlete plans going with a second session", () => {
    const swimmer = week({
      plan: { ...PLAN, sports: ["cycling", "swimming"], doubleDays: 1 },
      history: Array.from({ length: 8 }, (_, index) => ({
        date: addDayKey(MONDAY, -7 * (index + 1)),
        family: "other" as const,
        minutes: 120,
        load: 80,
      })),
    });
    const result = plan(swimmer);
    expect(sessions(result).some((item) => item.sport === "swimming")).toBe(true);
  });

  it("keeps what was planned on days behind and plans from today", () => {
    const first = plan();
    const wednesday = week({ today: WEDNESDAY });
    const again = plan(wednesday, [], first);
    expect(on(again, "2026-10-20")).toEqual(on(first, "2026-10-20"));
    expect(on(again, MONDAY)).toEqual(on(first, MONDAY));
  });

  it("marks days before the week was first planned", () => {
    const result = plan(week({ today: WEDNESDAY }));
    expect(on(result, "2026-10-20")).toMatchObject({ beforePlan: true, sessions: [] });
    expect(on(result, WEDNESDAY).beforePlan).toBe(false);
  });

  it("keeps the athlete's day off, time cap, indoor and easy days", () => {
    const result = plan(week(), [
      { date: "2026-10-20", kind: "off", minutes: null },
      { date: WEDNESDAY, kind: "short", minutes: 40 },
      { date: WEDNESDAY, kind: "indoor", minutes: null },
      { date: "2026-10-22", kind: "easy", minutes: null },
    ]);
    expect(on(result, "2026-10-20")).toMatchObject({ rest: true, sessions: [] });
    const wednesday = on(result, WEDNESDAY);
    expect(wednesday.indoor).toBe(true);
    for (const item of wednesday.sessions) expect(item.minutes).toBeLessThanOrEqual(45);
    expect(on(result, "2026-10-22").sessions.some((item) => item.kind === "key")).toBe(false);
  });

  it("pauses key sessions when form is very low", () => {
    const tired = week({ fitness: { ctl: 50, atl: 85 } });
    expect(keyDates(plan(tired))).toEqual([]);
  });
});

describe("goals in the week (ADR 0026)", () => {
  it("an A race: an opener the day before and the race on its day", () => {
    const race = goal(SUNDAY, { id: "a" });
    const result = plan(week({ nearbyGoals: [race] }));
    expect(on(result, SUNDAY).sessions).toMatchObject([{ kind: "race", goalIds: ["a"] }]);
    expect(on(result, SATURDAY).sessions).toMatchObject([
      { kind: "opener", sport: "cycling", keySessionId: "opener" },
    ]);
  });

  it("a race on a rest day still shows", () => {
    const race = goal("2026-10-23", { id: "c", priority: "C", objective: "finish" });
    expect(on(plan(week({ nearbyGoals: [race] })), "2026-10-23").sessions[0]?.kind).toBe("race");
  });

  it("a B goal to perform keeps three days before it easy and the two after", () => {
    const tuneUp = goal("2026-10-22", { id: "b", priority: "B", objective: "perform" });
    const result = plan(week({ nearbyGoals: [tuneUp] }));
    expect(on(result, WEDNESDAY).sessions[0]?.kind).toBe("opener");
    for (const date of ["2026-10-20", SATURDAY]) {
      expect(on(result, date).sessions.every((item) => item.kind !== "key")).toBe(true);
    }
  });

  it("a C race on the long session's sport stands in for the long session", () => {
    const club = goal(SUNDAY, { id: "c", priority: "C", objective: "finish" });
    const result = plan(week({ nearbyGoals: [club] }));
    expect(sessions(result).some((item) => item.keySessionId?.endsWith("long"))).toBe(false);
    expect(on(result, SUNDAY).sessions[0]?.note).toBe("Counts as this week's long session.");
  });

  it("a C race in another sport keeps the long session", () => {
    const run = goal(SUNDAY, { id: "c", priority: "C", objective: "finish", sportType: "Run" });
    const result = plan(week({ nearbyGoals: [run] }));
    expect(sessions(result).some((item) => item.keySessionId?.endsWith("long"))).toBe(true);
  });

  it("never puts a hard session next to a race", () => {
    const race = goal("2026-10-22", { id: "c", priority: "C", objective: "finish" });
    const result = plan(week({ nearbyGoals: [race] }));
    const hard = sessions(result).filter(
      (item) => item.kind === "key" && !item.keySessionId?.endsWith("long"),
    );
    for (const item of hard) expect(dayGap(item.date, "2026-10-22")).toBeGreaterThan(1);
  });
});

describe("matchWeek", () => {
  it("says what was done, missed, and extra", () => {
    const first = plan();
    const tuesday = on(first, "2026-10-20").sessions[0]!;
    const data = week({
      today: WEDNESDAY,
      activities: [
        activity({
          id: "done",
          date: "2026-10-20",
          sportType: tuesday.sport === "running" ? "Run" : "Ride",
          family: tuesday.sport === "running" ? "running" : "cycling",
          minutes: tuesday.minutes,
          zoneMinutes: [10, 10, 10, 40, 10],
        }),
        activity({ id: "walk", date: MONDAY, sportType: "Walk", family: "other", minutes: 30 }),
      ],
    });
    const views = matchWeek(first, data, summarizeWeek(data));
    expect(views[1]!.sessions[0]).toMatchObject({ state: "done", activity: { id: "done" } });
    expect(views[0]!.extras.map((extra) => extra.activity.id)).toEqual(["walk"]);
    expect(views[3]!.sessions.every((item) => item.state === "planned")).toBe(true);
  });

  it("an other sport never fills a planned session and shows as an extra (ADR 0029)", () => {
    const first = plan();
    const easy = sessions(first).find((item) => item.kind === "easy")!;
    const data = week({
      today: addDayKey(easy.date, 1),
      activities: [
        activity({
          id: "gym",
          date: easy.date,
          sportType: "WeightTraining",
          family: "other",
          minutes: easy.minutes,
        }),
      ],
    });
    const view = matchWeek(first, data, summarizeWeek(data)).find(
      (day) => day.day.date === easy.date,
    )!;
    expect(view.sessions.find((item) => item.session.id === easy.id)?.state).toBe("missed");
    expect(view.extras).toEqual([
      { activity: expect.objectContaining({ id: "gym" }), keySessionId: null },
    ]);
  });

  it("a missed key session planned again later is moved", () => {
    const first = plan();
    const missedDate = keyDates(first)[0]!;
    const later = week({ today: addDayKey(missedDate, 1) });
    const signals = replanSignals(first, later, summarizeWeek(later));
    expect(signals.missed.length).toBe(1);
    const again = plan(later, [], first);
    const views = matchWeek(again, later, summarizeWeek(later));
    const old = views.find((view) => view.day.date === missedDate)!.sessions[0]!;
    expect(["moved", "missed"]).toContain(old.state);
    if (old.state === "moved") {
      expect(
        sessions(again).filter((item) => item.keySessionId === old.session.keySessionId),
      ).toHaveLength(2);
    }
  });
});

describe("projectPlan", () => {
  it("raises fitness when the planned week is done", () => {
    const data = week();
    const summary = summarizeWeek(data);
    const projection = projectPlan(matchWeek(plan(data), data, summary), data, summary);
    expect(projection.fitnessSunday).toBeGreaterThan(projection.fitnessNow);
  });
});

describe("sessionRecommendation", () => {
  it("builds the steps of a planned key session", () => {
    const data = week();
    const summary = summarizeWeek(data);
    const result = plan(data);
    const day = result.days.find((item) => item.sessions.some((s) => s.kind === "key"))!;
    const pick = sessionRecommendation(data, summary, day, day.sessions[0]!);
    expect(pick).toMatchObject({ kind: "key" });
    expect(pick!.keySession).not.toBeNull();
  });
});

describe("coach notes", () => {
  it("reads a quick choice at once and leaves free text for the model", () => {
    expect(
      noteFrom({ date: WEDNESDAY, kind: "short", minutes: 40, text: "" }, "n1", NOW),
    ).toMatchObject({
      parsed: true,
      constraints: [{ date: WEDNESDAY, kind: "short", minutes: 40 }],
    });
    expect(
      noteFrom({ date: WEDNESDAY, kind: null, minutes: null, text: "storm" }, "n2", NOW).parsed,
    ).toBe(false);
  });

  it("hands what the model read to the notes still waiting", () => {
    const notes: CoachNote[] = [
      noteFrom({ date: WEDNESDAY, kind: null, minutes: null, text: "storm all day" }, "n", NOW),
    ];
    const read = withParsedConstraints(notes, [{ date: WEDNESDAY, kind: "indoor", minutes: null }]);
    expect(read[0]).toMatchObject({ parsed: true, constraints: [{ kind: "indoor" }] });
  });
});

describe("planWeeksAhead", () => {
  it("lays out the next weeks Monday to Sunday on the athlete's days, from today", () => {
    const ahead = planWeeksAhead(week({ today: WEDNESDAY }), [LEADING], {}, 2);
    expect(ahead.map((item) => item.weekStart)).toEqual(["2026-10-26", "2026-11-02"]);
    for (const item of ahead) {
      expect(item.days).toHaveLength(7);
      expect(item.days.every((day) => !day.beforePlan)).toBe(true);
      // Monday and Friday are rest days.
      expect(item.days[0]!.rest).toBe(true);
      expect(item.days[4]!.rest).toBe(true);
      const keys = item.days.flatMap((day) => day.sessions).filter((s) => s.kind === "key");
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(item.keyNames[key.keySessionId!]).toBeTruthy();
    }
  });

  it("puts a goal raced in a week ahead on its day", () => {
    const race = goal("2026-11-07", { id: "b-race", priority: "B" });
    const ahead = planWeeksAhead(week(), [race, LEADING], {}, 2);
    const day = ahead[1]!.days.find((item) => item.date === race.date)!;
    expect(day.sessions.map((item) => item.kind)).toEqual(["race"]);
  });
});
