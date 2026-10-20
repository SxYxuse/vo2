import { describe, expect, it } from "vite-plus/test";

import {
  addDayKey,
  easySessionRange,
  keySessionCount,
  recentSessionHistory,
  keySessionName,
  parseTrainingPlan,
  withKeySessionSport,
  type TrainingPlan,
} from "./training-plan.types.ts";
import {
  assignKeySports,
  customSplit,
  estimatedHardMinutes,
  generateKeySessions,
  keySessionRecommendation,
  minutesByZone,
  sessionSteps,
  projectWeek,
  recommendToday,
  summarizeWeek,
  usualWeekCurve,
  weeklyTarget,
  type DayTotal,
  type TodayChoice,
  type WeekActivity,
  type WeekTargetData,
} from "./week-target.ts";

const WEEK_START = "2026-10-19";
const WEDNESDAY = "2026-10-21";

const PLAN: TrainingPlan = {
  buildPace: "steady",
  targetMode: "manual",
  hoursIntent: "keep",
  // 60% of 5 sessions: 3 key sessions. At fitness 50 in the week of Oct 19 that is
  // 3 × 10 min Z4 (1h 05), 2 × 20 min Z3 (1h 10), and a 2h long Z2: 4h 15, then 2 easy sessions.
  weekMix: { minSessions: 5, maxSessions: 5, keyShare: 60, doubleDays: 0 },
  keySessionSports: {},
  targetWeeklyHours: 8,
  preferredRestWeekday: 0,
  timeZone: "UTC",
};

/** Today with no preference: VO2 picks. */
function auto(available: number): TodayChoice {
  return { available, sports: ["any"], feel: "auto" };
}

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
    collectors: { running: COLLECTORS, cycling: COLLECTORS },
    anchors: {
      ftpWatts: null,
      cyclingLthr: 160,
      cyclingMaxHr: 190,
      runLthr: 170,
      runMaxHr: 195,
    },
    ...overrides,
  };
}

describe("weeklyTarget", () => {
  it("sets hours from fitness and build pace in auto mode", () => {
    const target = weeklyTarget({
      plan: { ...PLAN, targetMode: "auto" },
      weekStartFitness: { ctl: 50, atl: 50 },
      loadPerHour: 56,
    });
    // 7 × 50 + 42 × 5 (steady) = 560 load, at 56 per hour.
    expect(target).toEqual({ minutes: 600, load: 560, source: "auto" });
  });

  it("holds fitness when the week starts very fatigued", () => {
    const target = weeklyTarget({
      plan: { ...PLAN, targetMode: "auto", buildPace: "overreach" },
      weekStartFitness: { ctl: 50, atl: 85 },
      loadPerHour: 50,
    });
    expect(target.load).toBe(350);
  });

  it("falls back to fixed hours without fitness history", () => {
    const target = weeklyTarget({
      plan: { ...PLAN, targetMode: "auto" },
      weekStartFitness: { ctl: 2, atl: 4 },
      loadPerHour: 42,
    });
    expect(target).toMatchObject({ minutes: 480, source: "no-history" });
  });
});

describe("summarizeWeek", () => {
  it("shows time left to reach the target", () => {
    const summary = summarizeWeek(
      week({ activities: [activity({ minutes: 90 }), activity({ id: "a2", minutes: 30 })] }),
    );
    expect(summary.doneMinutes).toBe(120);
    expect(summary.remainingMinutes).toBe(360);
    expect(summary.daysLeft).toBe(5);
    // Sunday is the rest day, so 4 training days carry 6h.
    expect(summary.trainingDaysLeft).toBe(4);
    expect(summary.perDayMinutes).toBe(90);
  });

  it("is not behind midweek when the athlete usually trains at the weekend", () => {
    const weekendHeavy = history([0, 60, 0, 0, 0, 240, 180]);
    expect(usualWeekCurve(weekendHeavy, WEEK_START)?.[1]).toBeCloseTo(0.125);

    const summary = summarizeWeek(
      week({ history: weekendHeavy, activities: [activity({ date: "2026-10-20", minutes: 60 })] }),
    );
    expect(summary.pace).toEqual({ expectedMinutes: 60, status: "on-track", fromHistory: true });

    const even = summarizeWeek(
      week({ activities: [activity({ date: "2026-10-20", minutes: 60 })] }),
    );
    expect(even.pace.status).toBe("behind");
    expect(even.pace.fromHistory).toBe(false);
  });

  it("splits what is left by the athlete's usual sports", () => {
    const mostlyRides = [
      ...history([60, 0, 60, 0, 0, 120, 0]),
      ...history([0, 40, 0, 40, 0, 0, 0], "running"),
    ];
    const summary = summarizeWeek(week({ history: mostlyRides }));
    expect(summary.bySport.cycling.left).toBeGreaterThan(summary.bySport.running.left);
    expect(summary.bySport.cycling.left + summary.bySport.running.left).toBeCloseTo(480, -1);
  });

  it("splits time left into key sessions and easy time", () => {
    const summary = summarizeWeek(
      week({ activities: [activity({ minutes: 60, zoneMinutes: [20, 30, 8, 2, 0] })] }),
    );
    expect(summary.keySessions.map((status) => status.done)).toEqual([null, null, null]);
    expect(summary.keySessions.map((status) => keySessionName(status.session))).toEqual([
      "3 × 10 min Z4",
      "2 × 20 min Z3",
      "Long Z2",
    ]);
    expect(summary.keyLeftMinutes).toBe(255);
    expect(summary.easy).toEqual({
      target: 480 - 255,
      left: 420 - 255,
      min: 2,
      max: 2,
      planned: 2,
      // The 60 min ride already filled one easy session.
      done: 1,
      perSession: 165,
      // 4 training days left, 3 of them for key sessions.
      singleDaySlots: 1,
    });
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
    expect(summary.keySessions[0].done?.id).toBe("run");
    expect(summary.keySessions[1].done).toBeNull();
  });

  it("lets one activity tick off only one key session, hardest first", () => {
    const bigRide = activity({ id: "big", minutes: 180, zoneMinutes: [30, 120, 5, 25, 0] });
    const summary = summarizeWeek(week({ activities: [bigRide] }));
    expect(summary.keySessions[0].done?.id).toBe("big");
    expect(summary.keySessions[1].done).toBeNull();
  });

  it("falls back to estimated hard time without a heart-rate stream", () => {
    const estimated = activity({ minutes: 60, hardMinutes: 30, hardSource: "estimate" });
    const summary = summarizeWeek(week({ activities: [estimated] }));
    expect(summary.keySessions[0].done?.id).toBe("a1");
  });

  it("pauses key sessions when form is very low", () => {
    const summary = summarizeWeek(week({ fitness: { ctl: 50, atl: 85 } }));
    expect(summary).toMatchObject({ paused: true, keyLeftMinutes: 0 });
    expect(summary.easy.left).toBe(480);
  });
});

describe("recommendToday", () => {
  it("picks the next key session that fits the window", () => {
    const data = week({ activities: [activity({ date: "2026-10-19", minutes: 60 })] });
    const pick = recommendToday(data, summarizeWeek(data), auto(60));
    // With no history the main session goes on the bike.
    expect(pick).toMatchObject({ kind: "key", family: "cycling", minutes: 65 });
    expect(pick.description).toMatch(/3 × 10 min in Z4 \(151–168 bpm\), 5 min easy between/);
    expect(pick.reasons).toContain("Key session 1 of 3 this week.");
  });

  it("plans a key session on the sport the athlete picked", () => {
    const id = `${WEEK_START}-1-threshold`;
    const data = week({ plan: { ...PLAN, keySessionSports: { [id]: "running" } } });
    const summary = summarizeWeek(data);
    expect(summary.keySessions[0]).toMatchObject({
      session: { id, sport: "running" },
      suggestedSport: "cycling",
      sportPinned: true,
    });
    const pick = recommendToday(data, summary, auto(60));
    expect(pick).toMatchObject({ kind: "key", family: "running" });
    // Friel Z4 is 95–99% of the 170 bpm running LTHR.
    expect(pick.description).toMatch(/3 × 10 min in Z4 \(161–168 bpm\)/);
  });

  it("prefers the key session planned on today's sport, then takes the other one", () => {
    const run = { ...auto(60), sports: ["running"] } satisfies TodayChoice;
    const data = week();
    expect(recommendToday(data, summarizeWeek(data), run)).toMatchObject({
      family: "running",
      title: "2 × 20 min Z3",
    });

    const tempoDone = activity({
      date: "2026-10-20",
      family: "running",
      sportType: "Run",
      zoneMinutes: [5, 10, 40, 0, 0],
    });
    const afterTempo = week({ activities: [tempoDone] });
    expect(recommendToday(afterTempo, summarizeWeek(afterTempo), run)).toMatchObject({
      family: "running",
      title: "3 × 10 min Z4",
    });
  });

  it("saves a key session for a longer window", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), auto(30));
    expect(pick.kind).toBe("easy");
    expect(pick.reasons).toContain("3 × 10 min Z4 needs 1h 05. Save it for a longer window.");
  });

  it("keeps today easy after hard work yesterday", () => {
    const data = week({
      activities: [activity({ date: "2026-10-20", minutes: 75, hardMinutes: 30 })],
    });
    const summary = summarizeWeek(data);
    // That ride already ticked off the threshold session; the long Z2 does not fit an hour.
    expect(summary.keySessions[0].done).not.toBeNull();
    const pick = recommendToday(data, summary, auto(60));
    expect(pick).toMatchObject({ kind: "easy", family: "running" });
    // Top of running zone 2 is 89% of running LTHR.
    expect(pick.description).toMatch(/under 151 bpm/);
  });

  it("offers the long Z2 in a big window when intervals must wait", () => {
    const data = week({
      activities: [
        activity({
          date: "2026-10-20",
          minutes: 60,
          hardMinutes: 20,
          zoneMinutes: [10, 30, 15, 5, 0],
        }),
      ],
    });
    const pick = recommendToday(data, summarizeWeek(data), auto(180));
    expect(pick).toMatchObject({ kind: "key", family: "cycling", minutes: 120 });
    expect(pick.title).toBe("Long Z2");
    expect(pick.after.fitnessChange).toBeGreaterThan(0);
  });

  it("only suggests recovery while key sessions are paused", () => {
    const data = week({ fitness: { ctl: 50, atl: 85 } });
    const pick = recommendToday(data, summarizeWeek(data), auto(90));
    expect(pick).toMatchObject({ kind: "recovery", minutes: 45 });
  });

  it("suggests rest once the target is met and fatigue is high", () => {
    const data = week({
      fitness: { ctl: 50, atl: 70 },
      activities: [activity({ minutes: 500 })],
    });
    const pick = recommendToday(data, summarizeWeek(data), auto(60));
    expect(pick).toMatchObject({ kind: "rest", minutes: 0 });
  });
});

describe("projectWeek", () => {
  it("flags a week far above the last four weeks", () => {
    const light = history([0, 30, 0, 30, 0, 60, 0]);
    const data = week({ history: light });
    const projection = projectWeek(data, summarizeWeek(data));
    expect(projection.recentAverageLoad).toBe(96);
    expect(projection.warn).toBe(true);
    expect(projection.fitnessSunday).toBeGreaterThan(projection.fitnessNow);
  });

  it("does not warn without recent weeks to compare", () => {
    const data = week();
    const projection = projectWeek(data, summarizeWeek(data));
    expect(projection.rampRatio).toBeNull();
    expect(projection.warn).toBe(false);
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
  it("keeps plans saved before the week target, defaulting to an auto target", () => {
    const plan = parseTrainingPlan({
      buildPace: "slow",
      maxRunSessions: 3,
      maxRideSessions: 2,
      maxDoubleDays: 1,
      hoursIntent: "keep",
      targetWeeklyHours: 6,
      preferredRestWeekday: 1,
      timeZone: "Europe/Brussels",
    });
    expect(plan).toEqual({
      buildPace: "slow",
      targetMode: "auto",
      hoursIntent: "keep",
      weekMix: { minSessions: 4, maxSessions: 6, keyShare: 0, doubleDays: 0 },
      keySessionSports: {},
      targetWeeklyHours: 6,
      preferredRestWeekday: 1,
      timeZone: "Europe/Brussels",
    });
  });
});

describe("assignKeySports", () => {
  const sessions = generateKeySessions({
    plan: {
      buildPace: "overreach",
      weekMix: { minSessions: 4, maxSessions: 4, keyShare: 100, doubleDays: 0 },
    },
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
    expect(sports({ cycling: 0.3, running: 0.7 })).toEqual([
      ["intervals", "running"],
      ["zone", "cycling"],
      ["intervals", "running"],
      ["long", "cycling"],
    ]);
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
      { [sessions[0].id]: "running" },
    );
    expect(first).toMatchObject({ sport: "running", suggestedSport: "cycling", sportPinned: true });
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

describe("legacy workout style", () => {
  it("turns intervals and zones into a key session matching the build pace", () => {
    const plan = parseTrainingPlan({
      buildPace: "fast",
      workoutStyle: "structured",
      hoursIntent: "keep",
      targetWeeklyHours: 8,
      preferredRestWeekday: 0,
      timeZone: "UTC",
    });
    expect(plan?.weekMix).toEqual({ minSessions: 4, maxSessions: 6, keyShare: 40, doubleDays: 0 });
  });
});

describe("sessionSteps", () => {
  it("lays out intervals as warm-up, reps with easy between, and cool-down", () => {
    const data = week();
    const summary = summarizeWeek(data);
    const pick = keySessionRecommendation(data, summary, summary.keySessions[0].session.id);
    const steps = sessionSteps(pick!, data);
    expect(steps.map((step) => [step.label, step.minutes, step.zone])).toEqual([
      ["Warm-up", 15, "z1"],
      ["Rep 1 of 3", 10, "z4"],
      ["Easy", 5, "z1"],
      ["Rep 2 of 3", 10, "z4"],
      ["Easy", 5, "z1"],
      ["Rep 3 of 3", 10, "z4"],
      ["Cool-down", 10, "z1"],
    ]);
    expect(steps.reduce((sum, step) => sum + step.minutes, 0)).toBe(pick!.minutes);
  });

  it("keeps a long Z2 steady between an easy start and finish", () => {
    const data = week();
    const summary = summarizeWeek(data);
    const pick = keySessionRecommendation(data, summary, summary.keySessions[2].session.id);
    const steps = sessionSteps(pick!, data);
    expect(minutesByZone(steps)).toEqual({ z1: 20, z2: 100, z3: 0, z4: 0, z5: 0 });
    expect(steps[1].cue).toMatch(/bpm/);
  });

  it("has nothing to show for a session no longer in the week mix", () => {
    const data = week();
    expect(keySessionRecommendation(data, summarizeWeek(data), "gone")).toBeNull();
  });
});

describe("generateKeySessions", () => {
  const base = { weekStart: WEEK_START, ctl: 50, targetMinutes: 480 };

  it("turns the split into a number of key sessions", () => {
    // A big week, so the 60% time budget never trims.
    const count = (sessions: number, keyShare: number) =>
      generateKeySessions({
        ...base,
        targetMinutes: 1200,
        plan: {
          buildPace: "steady",
          weekMix: { minSessions: sessions, maxSessions: sessions, keyShare, doubleDays: 0 },
        },
      }).length;
    expect(count(5, 20)).toBe(1);
    expect(count(6, 50)).toBe(3);
    expect(count(4, 0)).toBe(0);
    // Capped at 4 whatever the split.
    expect(count(12, 50)).toBe(4);
  });

  it("always leads with the build pace's main session and rotates the rest weekly", () => {
    const plan = {
      buildPace: "fast" as const,
      weekMix: { minSessions: 4, maxSessions: 4, keyShare: 50, doubleDays: 0 },
    };
    const names = (weekStart: string) =>
      generateKeySessions({ ...base, plan, weekStart }).map((session) =>
        session.id.split("-").at(-1),
      );
    expect(names("2026-10-19")).toEqual(["vo2", "long"]);
    expect(names("2026-10-26")).toEqual(["vo2", "threshold"]);
  });

  it("sizes sessions by fitness", () => {
    const plan = {
      buildPace: "steady" as const,
      weekMix: { minSessions: 5, maxSessions: 5, keyShare: 20, doubleDays: 0 },
    };
    const [low] = generateKeySessions({ ...base, plan, ctl: 20 });
    const [high] = generateKeySessions({ ...base, plan, ctl: 80 });
    expect(keySessionName(low)).toBe("3 × 8 min Z4");
    expect(keySessionName(high)).toBe("4 × 10 min Z4");
  });

  it("keeps key sessions under 60% of a small week, dropping the long one first", () => {
    const sessions = generateKeySessions({
      ...base,
      targetMinutes: 180,
      plan: {
        buildPace: "steady",
        weekMix: { minSessions: 3, maxSessions: 3, keyShare: 100, doubleDays: 0 },
      },
    });
    expect(sessions.map((session) => session.kind)).not.toContain("long");
    expect(sessions.length).toBe(1);
  });
});

describe("today's choice", () => {
  it("goes easy when asked, and keeps the key session open for another day", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 90,
      sports: ["any"],
      feel: "easy",
    });
    expect(pick.kind).toBe("easy");
    expect(pick.reasons[0]).toMatch(/3 × 10 min Z4 stays open/);
    expect(pick.warnings).toEqual([]);
  });

  it("goes hard when asked, even after a hard day, and says what it costs", () => {
    const data = week({
      activities: [
        activity({
          date: "2026-10-20",
          minutes: 60,
          hardMinutes: 20,
          zoneMinutes: [10, 30, 15, 5, 0],
        }),
      ],
    });
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 90,
      sports: ["any"],
      feel: "hard",
    });
    expect(pick.kind).toBe("key");
    expect(pick.keySession?.zone).toBe("z4");
    expect(pick.warnings.join(" ")).toMatch(/hard in the last day/);
  });

  it("shortens a key session to the window instead of refusing it", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 45,
      sports: ["any"],
      feel: "hard",
    });
    expect(pick.keySession?.reps).toBe(1);
    expect(pick.warnings).toContain("Shortened to fit 45 min.");
  });

  it("builds an extra key session when the mix has none left", () => {
    const data = week({
      plan: { ...PLAN, weekMix: { minSessions: 5, maxSessions: 5, keyShare: 0, doubleDays: 0 } },
    });
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 90,
      sports: ["any"],
      feel: "hard",
    });
    expect(pick.kind).toBe("key");
    expect(pick.warnings[0]).toMatch(/extra/);
  });

  it("keeps the sport the athlete picked", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 180,
      sports: ["running"],
      feel: "auto",
    });
    expect(pick.family).toBe("running");
  });

  it("splits a run + ride day by sport, the ride taking the larger share", () => {
    const data = week({
      plan: { ...PLAN, weekMix: { minSessions: 5, maxSessions: 5, keyShare: 0, doubleDays: 1 } },
    });
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 120,
      sports: ["running", "cycling"],
      feel: "auto",
    });
    // Two easy sessions of about 1h 35 would be 3h 10; the 2h window caps it, 1 : 1.5.
    expect(pick.parts).toEqual([
      { sport: "running", minutes: 50, main: true },
      { sport: "cycling", minutes: 70, main: false },
    ]);
    expect(pick.title).toBe("Easy run + easy ride");
    expect(pick.reasons).toContain("Double day · 1 of 1 left this week.");
    const steps = sessionSteps(pick, data);
    expect(steps.at(-1)).toMatchObject({ label: "Ride · Easy", minutes: 70, sport: "cycling" });
  });

  it("puts the key session on the ride when a swim comes first", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 120,
      sports: ["swimming", "cycling"],
      feel: "hard",
    });
    expect(pick.parts.map((part) => [part.sport, part.main])).toEqual([
      ["swimming", false],
      ["cycling", true],
    ]);
    expect(pick.title).toBe("Easy swim + 3 × 10 min Z4");
    expect(pick.description).toMatch(
      /^.+easy swim: Long, relaxed strokes.+ Then 15 min easy\. 3 × 10 min in Z4/,
    );
  });

  it("keeps a strength-only day easy, and says hard needs a ride or a run", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 60,
      sports: ["strength"],
      feel: "hard",
    });
    expect(pick).toMatchObject({ kind: "easy", family: "strength", title: "Strength session" });
    expect(pick.warnings).toContain("Key sessions are rides or runs. Add one to today to go hard.");
  });
});

describe("double days", () => {
  const plan = {
    ...PLAN,
    weekMix: { minSessions: 1, maxSessions: 9, keyShare: 0, doubleDays: 2 },
  };

  it("counts any two sessions on one date as a double day", () => {
    const summary = summarizeWeek(
      week({
        plan,
        activities: [
          activity({ id: "swim", sportType: "Swim", family: "other", minutes: 40 }),
          activity({ id: "ride", minutes: 60 }),
        ],
      }),
    );
    expect(summary.doubles).toEqual({ allowed: 2, used: 1, left: 1 });
  });

  it("plans extra easy sessions on double days and suggests a second sport", () => {
    // Saturday, Sunday rest: one training day, two double days allowed.
    const data = week({ plan, today: "2026-10-24" });
    const summary = summarizeWeek(data);
    expect(summary.easy).toMatchObject({ planned: 2, singleDaySlots: 1 });
    const pick = recommendToday(data, summary, auto(90));
    expect(pick.reasons).toContain("2 easy sessions left for 1 day: add a second sport today.");
  });

  it("warns, without refusing, when a second session goes past the allowed doubles", () => {
    const noDoubles = { ...plan, weekMix: { ...plan.weekMix, doubleDays: 0 } };
    const data = week({
      plan: noDoubles,
      activities: [activity({ date: WEDNESDAY, minutes: 45 })],
    });
    const pick = recommendToday(data, summarizeWeek(data), auto(60));
    expect(pick.minutes).toBeGreaterThan(0);
    expect(pick.warnings).toContain("Your week mix has no double days; this one is extra.");
  });
});

describe("re-planning from what was logged", () => {
  it("drops key sessions that no longer fit the days left and gives their time to easy", () => {
    // Saturday, with Sunday as the rest day: one training day for three key sessions.
    const data = week({ today: "2026-10-24" });
    const summary = summarizeWeek(data);
    expect(summary.keySessions.map((status) => status.skipped)).toEqual([false, true, true]);
    expect(summary.keyLeftMinutes).toBe(65);
    expect(summary.easy.target).toBe(480 - 65);
  });

  it("counts a hard day already done today against the days left for key sessions", () => {
    const data = week({
      today: "2026-10-24",
      activities: [
        activity({
          date: "2026-10-24",
          minutes: 40,
          hardMinutes: 20,
          zoneMinutes: [5, 15, 15, 5, 0],
        }),
      ],
    });
    const summary = summarizeWeek(data);
    expect(summary.keySessions.filter((status) => !status.skipped && !status.done)).toEqual([]);
  });

  it("lets an unplanned activity tick off whatever key session it matches", () => {
    const unplanned = activity({
      id: "group-ride",
      minutes: 150,
      zoneMinutes: [20, 90, 30, 10, 0],
    });
    const summary = summarizeWeek(week({ activities: [unplanned] }));
    // 40 min at Z3 or above covers the tempo block's 40 planned minutes.
    expect(summary.keySessions[1].done?.id).toBe("group-ride");
  });
});

describe("session range", () => {
  it("takes key sessions from the low end and gives the rest of the range to easy", () => {
    const mix = { minSessions: 4, maxSessions: 7, keyShare: 25, doubleDays: 0 };
    expect(keySessionCount(mix)).toBe(1);
    expect(easySessionRange(mix)).toEqual({ min: 3, max: 6 });
  });

  it("plans more easy sessions early in the week and settles lower as days run out", () => {
    const plan = {
      ...PLAN,
      weekMix: { minSessions: 4, maxSessions: 7, keyShare: 25, doubleDays: 0 },
    };
    const monday = summarizeWeek(week({ plan, today: WEEK_START }));
    // 6 training days (Sunday rest), one taken by the key session: 5 easy, within 3–6.
    expect(monday.easy).toMatchObject({ min: 3, max: 6, planned: 5, done: 0 });
    const saturday = summarizeWeek(week({ plan, today: "2026-10-24" }));
    expect(saturday.easy.planned).toBe(3);
  });

  it("reads the usual range from the last 3 months of activities", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const loads = Array.from({ length: 13 }, (_, week) =>
      Array.from({ length: week === 0 ? 2 : week % 3 === 0 ? 7 : 5 }, (_, index) => ({
        start: new Date(now.getTime() - (week * 7 + index * 0.5 + 0.25) * 86_400_000).toISOString(),
        load: 50,
        estimatedLoad: 0,
        movingTime: 3600,
      })),
    ).flat();
    const history = recentSessionHistory(loads, now);
    expect(history?.low).toBe(5);
    expect(history?.high).toBe(7);
    expect(history?.average).toBeCloseTo((2 + 4 * 7 + 8 * 5) / 13);
  });

  it("turns a saved single count into a range of one", () => {
    const plan = parseTrainingPlan({
      ...PLAN,
      weekMix: { sessions: 6, keyShare: 30, doubleDays: 0 },
    });
    expect(plan?.weekMix).toEqual({ minSessions: 6, maxSessions: 6, keyShare: 30, doubleDays: 0 });
  });
});

describe("splitting today's time", () => {
  const easyWeek = {
    ...PLAN,
    weekMix: { minSessions: 5, maxSessions: 5, keyShare: 0, doubleDays: 2 },
  };

  it("uses all the time picked when there are several sports", () => {
    const data = week({ plan: easyWeek });
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 180,
      sports: ["swimming", "cycling", "running"],
      feel: "auto",
    });
    // Weights 0.8 : 1.5 : 1 over 3h.
    expect(pick.parts.map((part) => [part.sport, part.minutes])).toEqual([
      ["swimming", 45],
      ["cycling", 80],
      ["running", 55],
    ]);
  });

  it("follows the athlete's own split, padding a key session with steady time", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 120,
      sports: ["swimming", "cycling"],
      feel: "hard",
      split: [30, 90],
    });
    expect(pick.parts.map((part) => part.minutes)).toEqual([30, 90]);
    const steps = sessionSteps(pick, data);
    // 3 × 10 min Z4 takes 1h 05; the other 25 min of the ride are steady before the cool-down.
    expect(steps.slice(-2).map((step) => [step.label, step.minutes])).toEqual([
      ["Ride · Steady", 25],
      ["Ride · Cool-down", 10],
    ]);
    expect(steps.reduce((sum, step) => sum + step.minutes, 0)).toBe(120);
    expect(pick.description).toMatch(/Add 25 min steady Z2 before the cool-down\./);
  });

  it("shortens the key session when its share of the split is small", () => {
    const data = week();
    const pick = recommendToday(data, summarizeWeek(data), {
      available: 120,
      sports: ["running", "swimming"],
      feel: "hard",
      split: [45, 75],
    });
    expect(pick.keySession?.reps).toBe(1);
    expect(pick.warnings.join(" ")).toMatch(/Shortened/);
  });

  it("falls back to VO2's split when the time or sports changed", () => {
    const choice = {
      available: 90,
      sports: ["running", "cycling"] as const,
      feel: "auto" as const,
    };
    expect(customSplit({ ...choice, sports: [...choice.sports], split: [30, 90] })).toBeNull();
    expect(customSplit({ ...choice, sports: ["running"], split: [30, 60] })).toBeNull();
    expect(customSplit({ ...choice, sports: [...choice.sports], split: [30, 60] })).toEqual([
      30, 60,
    ]);
  });
});
