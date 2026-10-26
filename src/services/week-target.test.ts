import { describe, expect, it } from "vite-plus/test";

import { seasonPhase, type SeasonPhase } from "./season-phase.ts";
import type { Goal } from "./season.types.ts";
import {
  addDayKey,
  keySessionCountFor,
  keySessionName,
  parseTrainingPlan,
  withKeySessionSport,
  type TrainingPlan,
} from "./training-plan.types.ts";
import {
  assignKeySports,
  buildRecommendation,
  capRunShare,
  estimatedHardMinutes,
  generateKeySessions,
  isTodayComplete,
  matchKeySessions,
  minutesByZone,
  planShares,
  sessionSteps,
  summarizeWeek,
  weeklyTarget,
  type DayTotal,
  type WeekActivity,
  type WeekTargetData,
} from "./week-target.ts";

const WEEK_START = "2026-10-19";
const WEDNESDAY = "2026-10-21";

/** Sunday off, long ride on Saturday, six training days. */
const PLAN: TrainingPlan = {
  restWeekdays: [0],
  longWeekday: 6,
  doubleDays: 0,
  sports: ["cycling", "running"],
  goals: null,
  startWeek: null,
  baselineMinutes: null,
  keySessionSports: {},
  timeZone: "UTC",
};

const MARATHON: Goal = {
  id: "goal",
  name: "Valencia Marathon",
  sportType: "Run",
  date: "2027-02-28",
  distanceM: 42_195,
  elevationGainM: null,
  objective: "perform",
  priority: "A",
};

/**
 * A build week at the old "steady" build pace toward a goal raced to perform: +5 fitness a
 * week, threshold first, three key sessions.
 */
const STEADY: SeasonPhase = {
  ...seasonPhase([], WEEK_START),
  kind: "build",
  ramp: 5,
  rotation: "steady",
  anchor: [MARATHON],
  objective: "perform",
};

const COLLECTORS = { heartRate: true, power: false, powerPartial: false };

function activity(overrides: Partial<WeekActivity>): WeekActivity {
  return {
    id: "a1",
    title: "Morning Ride",
    date: WEEK_START,
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

/** Eight past weeks that each put `byWeekday` minutes (Monday first) on cycling. */
function history(byWeekday: number[], family: DayTotal["family"] = "cycling"): DayTotal[] {
  const days: DayTotal[] = [];
  for (let week = 1; week <= 8; week += 1) {
    const start = addDayKey(WEEK_START, -7 * week);
    byWeekday.forEach((minutes, index) => {
      if (minutes > 0) {
        days.push({ date: addDayKey(start, index), family, minutes, load: minutes * 0.8 });
      }
    });
  }
  return days;
}

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
    weekStartFitness: { ctl: 50, atl: 50 },
    fitness: { ctl: 50, atl: 50 },
    collectors: {
      running: COLLECTORS,
      cycling: COLLECTORS,
      swimming: COLLECTORS,
      walking: COLLECTORS,
    },
    season: STEADY,
    nearbyGoals: [],
    anchors: {
      ftpWatts: null,
      heartRate: {
        cycling: { maxHr: 190, lthr: 160 },
        running: { maxHr: 195, lthr: 170 },
        swimming: { maxHr: 180, lthr: 150 },
        walking: { maxHr: 185, lthr: null },
      },
    },
    ...overrides,
  };
}

describe("weeklyTarget", () => {
  const base = { plan: PLAN, weekStart: WEEK_START, loadPerHour: 56 };

  it("sets hours from fitness and the phase's ramp", () => {
    const target = weeklyTarget({
      ...base,
      season: STEADY,
      weekStartFitness: { ctl: 50, atl: 50 },
    });
    // 7 × 50 + 42 × 5 (steady) = 560 load, at 56 per hour.
    expect(target).toEqual({ minutes: 600, load: 560, source: "auto" });
  });

  it("holds fitness when the week starts very fatigued", () => {
    const target = weeklyTarget({
      ...base,
      loadPerHour: 50,
      season: { ramp: 12, loadFactor: null },
      weekStartFitness: { ctl: 50, atl: 85 },
    });
    expect(target.load).toBe(350);
  });

  it("gives 45 minutes per training day without fitness history", () => {
    const target = weeklyTarget({ ...base, season: STEADY, weekStartFitness: { ctl: 2, atl: 4 } });
    expect(target).toMatchObject({ minutes: 6 * 45, source: "no-history" });
    const fewer = weeklyTarget({
      ...base,
      plan: { ...PLAN, restWeekdays: [1, 3, 5] },
      season: STEADY,
      weekStartFitness: { ctl: 2, atl: 4 },
    });
    expect(fewer.minutes).toBe(4 * 45);
  });

  it("grows from the athlete's starting point after a break by 10 % a week at most", () => {
    const comeback = { ...PLAN, baselineMinutes: 240, startWeek: "2026-10-05" };
    const target = weeklyTarget({
      ...base,
      plan: comeback,
      season: STEADY,
      weekStartFitness: { ctl: 50, atl: 50 },
    });
    // Two weeks in: 240 × 1.1² ≈ 290.
    expect(target).toMatchObject({ minutes: 290, source: "baseline" });
    // Once fitness asks for less, fitness wins.
    const late = weeklyTarget({
      ...base,
      plan: { ...comeback, startWeek: "2026-01-05" },
      season: STEADY,
      weekStartFitness: { ctl: 50, atl: 50 },
    });
    expect(late.source).toBe("auto");
  });
});

describe("keySessionCountFor", () => {
  it("follows the objective within the phase and half the training days", () => {
    const count = (objective: "finish" | "finishWell" | "perform" | null, days = 6, max = null) =>
      keySessionCountFor({ objective, phaseMax: max, trainingDays: days });
    expect(count("finish")).toBe(1);
    expect(count("finishWell")).toBe(2);
    expect(count("perform")).toBe(3);
    expect(count(null)).toBe(1);
    expect(count("perform", 4)).toBe(2);
    expect(keySessionCountFor({ objective: "perform", phaseMax: 1, trainingDays: 6 })).toBe(1);
  });
});

describe("summarizeWeek", () => {
  it("shows time left to reach the target", () => {
    const summary = summarizeWeek(
      week({ activities: [activity({ minutes: 90 }), activity({ id: "a2", minutes: 30 })] }),
    );
    expect(summary.doneMinutes).toBe(120);
    expect(summary.remainingMinutes).toBe(summary.target.minutes - 120);
    expect(summary.trainingDays).toBe(6);
  });

  it("splits what is left by the athlete's usual sports", () => {
    const mostlyRides = [
      ...history([60, 0, 60, 0, 0, 120, 0]),
      ...history([0, 40, 0, 40, 0, 0, 0], "running"),
    ];
    const summary = summarizeWeek(week({ history: mostlyRides }));
    expect(summary.bySport.cycling.left).toBeGreaterThan(summary.bySport.running.left);
  });

  it("keeps sports the athlete does not plan out of the week", () => {
    const summary = summarizeWeek(
      week({
        plan: { ...PLAN, sports: ["cycling"] },
        history: [...history([60, 0, 60, 0, 0, 120, 0]), ...history([0, 40], "running")],
      }),
    );
    expect(summary.shares.running).toBe(0);
    expect(summary.keySessions.every((status) => status.session.sport === "cycling")).toBe(true);
  });

  it("builds the objective's key sessions", () => {
    const summary = summarizeWeek(week());
    expect(summary.keySessions.map((status) => keySessionName(status.session))).toEqual([
      "3 × 10 min Z4",
      "Long Z2",
      "2 × 20 min Z3",
    ]);
  });

  it("ticks a key session off by time in zone, not by duration", () => {
    const shortRun = activity({
      id: "run",
      family: "running",
      sportType: "Run",
      minutes: 50,
      // 25 min at Z4 or above is 80% of the 30 planned.
      zoneMinutes: [10, 10, 5, 20, 5],
    });
    const summary = summarizeWeek(week({ activities: [shortRun] }));
    expect(summary.keySessions[0]!.done?.id).toBe("run");
    expect(summary.keySessions[1]!.done).toBeNull();
  });

  it("lets one activity tick off only one key session, hardest first", () => {
    const bigRide = activity({ id: "big", minutes: 180, zoneMinutes: [30, 120, 5, 25, 0] });
    const summary = summarizeWeek(week({ activities: [bigRide] }));
    expect(summary.keySessions[0]!.done?.id).toBe("big");
    expect(summary.keySessions[1]!.done).toBeNull();
  });

  it("falls back to estimated hard time without a heart-rate stream", () => {
    const estimated = activity({ minutes: 60, hardMinutes: 30, hardSource: "estimate" });
    const summary = summarizeWeek(week({ activities: [estimated] }));
    expect(summary.keySessions[0]!.done?.id).toBe("a1");
  });

  it("pauses key sessions when form is very low", () => {
    expect(summarizeWeek(week({ fitness: { ctl: 50, atl: 85 } })).paused).toBe(true);
  });
});

describe("isTodayComplete", () => {
  it("is complete once an activity is copied today", () => {
    expect(isTodayComplete(week())).toBe(false);
    expect(isTodayComplete(week({ activities: [activity({ date: WEDNESDAY })] }))).toBe(true);
  });
});

describe("estimatedHardMinutes", () => {
  it("counts nothing for easy load and everything near threshold", () => {
    // Duration-only run load sits at 0.7 intensity.
    expect(estimatedHardMinutes(60, 49)).toBe(0);
    expect(estimatedHardMinutes(60, 95 * 0.95)).toBe(60);
  });
});

describe("parseTrainingPlan", () => {
  it("turns a plan saved before the plan builder into a week shape that follows Season", () => {
    const plan = parseTrainingPlan({
      targetMode: "manual",
      weekMix: { minSessions: 4, maxSessions: 6, keyShare: 20, doubleDays: 2 },
      keySessionSports: {},
      targetWeeklyHours: 6,
      preferredRestWeekday: 6,
      timeZone: "Europe/Brussels",
    });
    expect(plan).toEqual({
      restWeekdays: [6],
      longWeekday: 0,
      doubleDays: 2,
      sports: ["cycling", "running"],
      goals: null,
      startWeek: null,
      baselineMinutes: null,
      keySessionSports: {},
      timeZone: "Europe/Brussels",
    });
  });

  it("keeps very old plans too", () => {
    const plan = parseTrainingPlan({
      buildPace: "slow",
      hoursIntent: "keep",
      targetWeeklyHours: 6,
      preferredRestWeekday: 1,
      timeZone: "UTC",
    });
    expect(plan).toMatchObject({ restWeekdays: [1], longWeekday: 6, doubleDays: 0 });
  });

  it("refuses a long session day that is a rest day", () => {
    expect(parseTrainingPlan({ ...PLAN, longWeekday: 0 })).toBeNull();
    expect(parseTrainingPlan({ ...PLAN, restWeekdays: [] })).toBeNull();
  });
});

describe("planShares", () => {
  it("moves the time of sports the athlete does not plan onto the others", () => {
    const shares = planShares({ cycling: 0.6, running: 0.3, other: 0.1 }, ["cycling", "running"]);
    expect(shares.cycling).toBeCloseTo(2 / 3);
    expect(shares.running).toBeCloseTo(1 / 3);
    expect(shares.other).toBe(0);
  });
});

describe("assignKeySports", () => {
  const sessions = generateKeySessions({
    count: 4,
    season: { rotation: "overreach" },
    weekStart: WEEK_START,
    ctl: 50,
    targetMinutes: 1200,
  });
  const sports = (shares: { cycling: number; running: number }, pinned = {}) =>
    assignKeySports(sessions, { ...shares, other: 0 }, pinned).map((session) => [
      session.kind,
      session.sport,
    ]);

  it("puts the main session on the sport done most and spreads the rest by balance", () => {
    const planned = sports({ cycling: 0.3, running: 0.7 });
    expect(planned[0]).toEqual(["intervals", "running"]);
    expect(planned.find(([kind]) => kind === "long")?.[1]).toBe("cycling");
    expect(planned.filter(([kind]) => kind !== "long").map(([, sport]) => sport)).toContain(
      "cycling",
    );
  });

  it("keeps a runner's whole week on foot", () => {
    expect(sports({ cycling: 0.05, running: 0.95 }).map(([, sport]) => sport)).toEqual([
      "running",
      "running",
      "running",
      "running",
    ]);
  });

  it("lets the athlete's pick win and remembers the suggestion", () => {
    const [first] = assignKeySports(
      sessions,
      { cycling: 1, running: 0, other: 0 },
      { [sessions[0]!.id]: "running" },
    );
    expect(first).toMatchObject({ sport: "running", suggestedSport: "cycling", sportPinned: true });
  });

  it("puts the main and long sessions on the goal's sport", () => {
    const planned = assignKeySports(
      sessions,
      { cycling: 0.8, running: 0.2, other: 0 },
      {},
      { keySport: "running" },
    );
    expect(planned[0]!.sport).toBe("running");
    expect(planned.find((session) => session.kind === "long")?.sport).toBe("running");
    expect(planned.some((session) => session.sport === "cycling")).toBe(true);
  });

  it("plans only the athlete's own sports", () => {
    const planned = assignKeySports(sessions, { cycling: 0, running: 0, other: 1 }, {}, null, [
      "swimming",
    ]);
    expect(planned.every((session) => session.sport === "swimming")).toBe(true);
  });
});

describe("withKeySessionSport", () => {
  const thisWeek = `${WEEK_START}-1-threshold`;
  const lastWeek = "2026-10-12-1-threshold";

  it("sets a pick and drops picks from other weeks", () => {
    expect(
      withKeySessionSport(
        { [lastWeek]: "running", [`${WEEK_START}-2-tempo`]: "cycling" },
        { id: thisWeek, sport: "running" },
      ),
    ).toEqual({ [`${WEEK_START}-2-tempo`]: "cycling", [thisWeek]: "running" });
  });

  it("goes back to the suggestion when cleared", () => {
    expect(withKeySessionSport({ [thisWeek]: "running" }, { id: thisWeek, sport: null })).toEqual(
      {},
    );
  });
});

describe("sessionSteps", () => {
  const pickFor = (index: number) => {
    const data = week();
    const summary = summarizeWeek(data);
    const session = summary.keySessions[index]!.session;
    const pick = buildRecommendation(
      {
        kind: "key",
        keySession: session,
        parts: [{ sport: "cycling", minutes: summary.keySessions[index]!.minutes, main: true }],
        reasons: [],
      },
      data,
      summary,
    );
    return { pick, steps: sessionSteps(pick, data) };
  };

  it("lays out intervals as warm-up, reps with easy between, and cool-down", () => {
    const { pick, steps } = pickFor(0);
    expect(steps.map((step) => [step.label, step.minutes, step.zone])).toEqual([
      ["Warm-up", 15, "z1"],
      ["Rep 1 of 3", 10, "z4"],
      ["Easy", 5, "z1"],
      ["Rep 2 of 3", 10, "z4"],
      ["Easy", 5, "z1"],
      ["Rep 3 of 3", 10, "z4"],
      ["Cool-down", 10, "z1"],
    ]);
    expect(steps.reduce((sum, step) => sum + step.minutes, 0)).toBe(pick.minutes);
  });

  it("keeps a long Z2 steady between an easy start and finish", () => {
    const { steps } = pickFor(1);
    expect(minutesByZone(steps).z2).toBeGreaterThan(0);
    expect(minutesByZone(steps).z1).toBe(20);
    expect(steps[1]!.cue).toMatch(/bpm/);
  });
});

describe("generateKeySessions", () => {
  const base = { weekStart: WEEK_START, ctl: 50, targetMinutes: 480 };

  it("builds as many key sessions as asked, up to the cap", () => {
    const count = (n: number) =>
      generateKeySessions({
        ...base,
        targetMinutes: 1200,
        count: n,
        season: { rotation: "steady" },
      }).length;
    expect(count(1)).toBe(1);
    expect(count(3)).toBe(3);
    expect(count(0)).toBe(0);
  });

  it("always leads with the phase's main session, then the long one, and rotates the rest", () => {
    const names = (weekStart: string) =>
      generateKeySessions({
        ...base,
        targetMinutes: 1200,
        count: 4,
        season: { rotation: "overreach" },
        weekStart,
      }).map((session) => session.id.split("-").at(-1));
    expect(names("2026-10-19").slice(0, 2)).toEqual(["vo2", "long"]);
    expect(names("2026-10-19")).not.toEqual(names("2026-10-26"));
  });

  it("sizes sessions by fitness", () => {
    const [low] = generateKeySessions({
      ...base,
      count: 1,
      season: { rotation: "steady" },
      ctl: 20,
    });
    const [high] = generateKeySessions({
      ...base,
      count: 1,
      season: { rotation: "steady" },
      ctl: 80,
    });
    expect(keySessionName(low!)).toBe("3 × 8 min Z4");
    expect(keySessionName(high!)).toBe("4 × 10 min Z4");
  });

  it("keeps key sessions under 60% of a small week, dropping intervals before the long one", () => {
    const sessions = generateKeySessions({
      ...base,
      targetMinutes: 180,
      count: 3,
      season: { rotation: "steady" },
    });
    expect(sessions.map((session) => session.kind)).toEqual(["long"]);
  });

  it("shortens the long session rather than dropping it", () => {
    const sessions = generateKeySessions({
      ...base,
      targetMinutes: 150,
      count: 2,
      season: { rotation: "slow", kind: "base", sessions: { longMinutes: 180 } },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: "long", workMinutes: 90 });
  });

  it("toward a goal the long session leads in base and comes second from build on", () => {
    const toward = (kind: SeasonPhase["kind"]) =>
      generateKeySessions({
        ...base,
        targetMinutes: 900,
        count: 2,
        season: { rotation: "fast", kind, sessions: { longMinutes: 150 } },
      }).map((session) => session.kind);
    expect(toward("base")[0]).toBe("long");
    expect(toward("build")[1]).toBe("long");
  });
});

describe("guardrails (ADR 0024)", () => {
  it("holds running to recent running plus 15 %, moving the rest to riding", () => {
    const rides = history([60, 0, 60, 0, 0, 120, 0]);
    const runs = history([0, 30, 0, 30, 0, 0, 0], "running");
    const { shares, runCapped } = capRunShare(
      { running: 0.7, cycling: 0.3, other: 0 },
      [...rides, ...runs],
      600,
    );
    expect(runCapped).toBe(true);
    expect(shares.running * 600).toBeCloseTo(69);
    expect(shares.running + shares.cycling).toBeCloseTo(1);
  });

  it("a goal's long session only counts on the goal's sport", () => {
    const long = {
      ...generateKeySessions({
        weekStart: WEEK_START,
        ctl: 50,
        targetMinutes: 600,
        count: 1,
        season: { rotation: "hold", kind: "base", sessions: { longMinutes: 120 } },
      })[0]!,
      sport: "running" as const,
      suggestedSport: "running" as const,
      sportPinned: false,
    };
    const ride = activity({ id: "ride", minutes: 180 });
    const run = activity({ id: "run", sportType: "Run", family: "running", minutes: 130 });
    expect(matchKeySessions([long], [ride], "running")[0]!.done).toBeNull();
    expect(matchKeySessions([long], [ride, run], "running")[0]!.done?.id).toBe("run");
  });

  it("an other sport never ticks off a key session, however hard it was (ADR 0029)", () => {
    const [intervals] = assignKeySports(
      generateKeySessions({
        count: 1,
        season: { rotation: "fast" },
        weekStart: WEEK_START,
        ctl: 50,
        targetMinutes: 600,
      }),
      { cycling: 1, running: 0, other: 0 },
      {},
    );
    const hard = { minutes: 90, zoneMinutes: [0, 0, 0, 45, 45] };
    const workout = activity({ id: "workout", sportType: "Workout", family: "other", ...hard });
    const ride = activity({ id: "ride", ...hard });
    expect(matchKeySessions([intervals!], [workout])[0]!.done).toBeNull();
    expect(matchKeySessions([intervals!], [ride])[0]!.done?.id).toBe("ride");
  });
});
