import { describe, expect, it } from "vite-plus/test";

import {
  daysOutside,
  seasonShape,
  weekBudgets,
  type SportDay,
  type TimeOutDays,
} from "./coach-plan-budget.ts";
import { mockCoachPlan } from "./coach-plan-mock.ts";
import {
  checkPlan,
  longestAllowed,
  MAX_LONG_MINUTES,
  MAX_LONG_RIDE_MINUTES,
  MAX_LONG_SWIM_MINUTES,
  raceWeeks,
  sessionsAvailable,
  weekFloor,
  type RuleContext,
} from "./coach-plan-rules.ts";
import {
  PLAN_SPORTS,
  plannedSession,
  plannedSports,
  stepSecPerKm,
  swimSecPer100m,
  type Availability,
  type PlanAnchors,
  type PlanSport,
  type Progression,
} from "./coach-plan.types.ts";
import { addDayKey } from "./day-key.ts";
import type { Goal, GoalEffort } from "./season.types.ts";
import {
  estimateVdot,
  predictRaceSeconds,
  RACE_DISTANCES,
  trainingPaceRanges,
  trainingPaces,
  vdotFromRace,
  type RunEffort,
} from "./training-paces.types.ts";

/*
 * The property guard for the coach plan's rules, budgets and paces (#204). Review found every
 * past blocker here by running the pure functions over thousands of generated athletes, so this
 * does the same on every gate: generated availabilities, histories, goals, progressions and paces,
 * seeded so a failure names a case that replays. Extend the generators when you add an input.
 */

/** Each athlete costs about 3 ms in weekBudgets alone; 600 keep the guard to a few seconds. */
const CASES = 600;
const PACE_CASES = 3000;

/** A seeded generator (mulberry32), so every run checks the same athletes. */
function random(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const between = (low: number, high: number) => low + next() * (high - low);
  return {
    next,
    between,
    int: (low: number, high: number) => Math.floor(between(low, high + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
  };
}
type Random = ReturnType<typeof random>;

/** A Monday: the plan's current week. */
const CURRENT_WEEK = "2027-01-04";
const SPORT_TYPE: Record<PlanSport, Goal["sportType"]> = { run: "Run", ride: "Ride", swim: "Swim" };

function availabilityOf(r: Random): Availability {
  for (;;) {
    const sessions = () => (r.next() < 0.4 ? 0 : r.int(1, 6));
    const availability = { runsPerWeek: sessions(), ridesPerWeek: sessions(), swimsPerWeek: 0 };
    if (r.next() < 0.3) availability.swimsPerWeek = r.int(1, 6);
    const total = availability.runsPerWeek + availability.ridesPerWeek + availability.swimsPerWeek;
    if (total >= 2) return availability;
  }
}

/**
 * Six months of one sport: none, steady, building, or back from a break, at a weekly level from
 * little to a lot, in 1 to 6 sessions a week with one longer.
 */
function historyOf(r: Random, sport: PlanSport, today: string): SportDay[] {
  const shape = r.pick(["none", "steady", "building", "break"] as const);
  if (shape === "none") return [];
  // Weekly level in km of running, km of riding at 25 km/h, km of swimming.
  const level = { run: r.between(5, 110), ride: r.between(30, 400), swim: r.between(1, 25) }[sport];
  const perWeek = r.int(1, 6);
  const breakWeeks = shape === "break" ? r.int(2, 12) : 0;
  const days: SportDay[] = [];
  for (let week = 26; week >= 1; week -= 1) {
    if (week <= breakWeeks) continue;
    const ramp = shape === "building" ? 0.5 + (0.5 * (26 - week)) / 26 : 1;
    const weekKm = level * ramp * r.between(0.7, 1.2);
    const start = addDayKey(CURRENT_WEEK, -7 * week);
    for (let index = 0; index < perWeek; index += 1) {
      const date = addDayKey(start, index);
      if (date >= today) continue;
      const share = perWeek === 1 ? 1 : index === 0 ? 0.35 : 0.65 / (perWeek - 1);
      const km = weekKm * share;
      const minutes = sport === "ride" ? (km / 25) * 60 : sport === "run" ? km * 6 : km * 25;
      days.push({ date, km, minutes });
    }
  }
  // This week's sessions before today.
  for (let date = CURRENT_WEEK; date < today; date = addDayKey(date, 1)) {
    if (r.next() < 0.4) days.push({ date, km: level / 5, minutes: level });
  }
  return days;
}

/** An A goal in a planned sport 1 to 30 weeks out, and sometimes a supporting race before it. */
function goalsOf(r: Random, availability: Availability, today: string): Goal[] {
  const sport = r.pick(plannedSports(availability));
  const distanceM = {
    run: r.pick([5000, 10_000, 21_097.5, 42_195, 50_000]),
    ride: r.pick([40_000, 90_000, 160_000, 250_000]),
    swim: r.pick([750, 1500, 1900, 3800, 10_000]),
  }[sport];
  const aDate = addDayKey(today, r.int(3, 210));
  const goals: Goal[] = [
    {
      id: "a",
      name: "A race",
      sportType: SPORT_TYPE[sport],
      date: aDate,
      distanceM,
      elevationGainM: sport === "ride" ? r.int(0, 4000) : null,
      priority: "A",
      effort: null,
    },
  ];
  if (r.next() < 0.4) {
    const supportSport = r.pick(plannedSports(availability));
    goals.push({
      id: "b",
      name: "Supporting race",
      sportType: SPORT_TYPE[supportSport],
      date: addDayKey(today, r.int(1, Math.max(1, Math.floor(daysTo(today, aDate) - 7)))),
      distanceM: { run: 10_000, ride: 60_000, swim: 1500 }[supportSport],
      elevationGainM: null,
      priority: "B",
      effort: r.pick<GoalEffort>(["fun", "steady", "allOut"]),
    });
  }
  return goals;
}

const daysTo = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

function progressionOf(r: Random): Progression {
  const progression: Progression = {};
  for (const { id } of PLAN_SPORTS) {
    if (r.next() < 0.5) continue;
    const peak =
      r.next() < 0.7
        ? null
        : { run: r.int(10, 200), ride: r.int(60, 1500), swim: r.int(1000, 60_000) }[id];
    progression[id] = { growth: r.int(0, 20) / 2, peak };
  }
  return progression;
}

/**
 * The athlete's time outs (ADR 0066): none, one in the past, a few days of one week, whole weeks,
 * one still open, one ahead, or one ending in the weeks before the A goal's taper.
 */
function timeOutsOf(r: Random, today: string, aGoal: Goal): TimeOutDays[] {
  const shape = r.pick(["none", "past", "partial", "weeks", "open", "ahead", "taper"] as const);
  if (shape === "none") return [];
  if (shape === "past") {
    const end = addDayKey(CURRENT_WEEK, -r.int(1, 20));
    return [{ start: addDayKey(end, -r.int(0, 14)), end }];
  }
  if (shape === "partial") {
    const start = addDayKey(CURRENT_WEEK, 7 * r.int(0, 3) + r.int(0, 6));
    return [{ start, end: addDayKey(start, r.int(0, 5)) }];
  }
  if (shape === "weeks") {
    const start = addDayKey(CURRENT_WEEK, 7 * r.int(0, 2) - r.int(0, 3));
    return [{ start, end: addDayKey(start, 7 * r.int(1, 3) + r.int(0, 3)) }];
  }
  if (shape === "open") return [{ start: addDayKey(today, -r.int(0, 20)), end: null }];
  if (shape === "taper") {
    const end = addDayKey(aGoal.date, -r.int(1, 24));
    const start = addDayKey(end, -r.int(0, 20));
    if (start < addDayKey(CURRENT_WEEK, -28) || start > addDayKey(today, 28)) return [];
    return [{ start, end }];
  }
  const start = addDayKey(today, r.int(1, 28));
  return [{ start, end: r.next() < 0.3 ? null : addDayKey(start, r.int(0, 20)) }];
}

/** An athlete as the server reads them, and the context the coach's plan is checked against. */
function athlete(seed: number) {
  const r = random(seed);
  const today = addDayKey(CURRENT_WEEK, r.int(0, 6));
  const availability = availabilityOf(r);
  const history = { run: historyOf(r, "run", today), ride: historyOf(r, "ride", today) };
  const swimHistory = historyOf(r, "swim", today);
  const goals = goalsOf(r, availability, today);
  const timeOuts = timeOutsOf(r, today, goals[0]!);
  // Nothing is trained inside a time out.
  const outside = (days: SportDay[]) =>
    days.filter(
      (day) =>
        !timeOuts.some(({ start, end }) => day.date >= start && (end == null || day.date <= end)),
    );
  const runs = outside(history.run);
  const rides = outside(history.ride);
  const swims = outside(swimHistory);
  const anchors: PlanAnchors = {
    paces: r.next() < 0.2 ? null : trainingPaceRanges(r.between(28, 75)),
    ftp: r.next() < 0.5 ? null : r.int(120, 380),
    rideLthr: null,
    css: r.next() < 0.4 ? null : r.int(70, 150),
  };
  const budgetInput = {
    runs,
    rides,
    swims,
    goals,
    aGoal: goals[0]!,
    firstWeek: CURRENT_WEEK,
    count: 4,
    availability,
    progression: progressionOf(r),
  };
  const budgets = weekBudgets({ ...budgetInput, timeOuts });
  /** The budgets as they were before time outs: the same athlete without them. */
  const before = timeOuts.length ? weekBudgets(budgetInput) : budgets;
  const lastDay = addDayKey(budgets.at(-1)!.weekStart, 6);
  const easyRun = stepSecPerKm(
    { ...EASY_STEP, distanceM: 1000, durationS: null, effort: "easy" },
    anchors.paces,
  );
  const ctx: RuleContext = {
    availability,
    weeks: budgets,
    fromWeek: CURRENT_WEEK,
    today,
    frozen: [],
    runs,
    rides,
    swims,
    races: raceWeeks(goals, CURRENT_WEEK, lastDay).map(({ race }) => race),
    neighbours: [],
    easySecPerKm: easyRun,
    easySecPer100m: swimSecPer100m({ zone: "endurance", effort: null }, anchors.css),
    paces: anchors.paces,
    racePaces: [],
  };
  const shares = seasonShape(goals, goals[0]!, CURRENT_WEEK, 4).map((week) => week.share);
  return { ctx, anchors, seed, timeOuts, before, shares };
}

const EASY_STEP = {
  part: "work",
  pace: null,
  secPerKm: null,
  zone: null,
  drill: null,
} as const;

let generated: ReturnType<typeof athlete>[] | undefined;
/** Generated in the first test that reads them, so their time counts as the guard's. */
const athletes = () =>
  (generated ??= Array.from({ length: CASES }, (_, index) => athlete(index + 1)));
/** The athlete's seed and setup, so a failure can be replayed with athlete(seed). */
const label = ({ seed, ctx }: ReturnType<typeof athlete>) =>
  `seed ${seed}: ${JSON.stringify(ctx.availability)}, today ${ctx.today}, budgets ${JSON.stringify(
    ctx.weeks.map((week) => [week.budgetKm, week.budgetMinutes, week.budgetSwimM]),
  )}`;

/** The longest session's time cap in the sport's unit, worked out here from the rule's minutes. */
function timeCap(sport: PlanSport, ctx: RuleContext) {
  if (sport === "run") return (MAX_LONG_MINUTES * 60) / ctx.easySecPerKm;
  if (sport === "swim") return ((MAX_LONG_SWIM_MINUTES * 60) / ctx.easySecPer100m) * 100;
  return MAX_LONG_RIDE_MINUTES;
}

const BUDGET_KEY = { run: "budgetKm", ride: "budgetMinutes", swim: "budgetSwimM" } as const;
/** The budgets' rounding: whole km, 5 minutes, 100 m. */
const ROUND_TO = { run: 1, ride: 5, swim: 100 } as const;

/** Each week back after the first adds this share of the level (ADR 0066). */
const RAMP_STEP = 0.15;

/**
 * The ramp's share of the level in a week after a time out ends (ADR 0066): 80 / 60 / 40 % after
 * 1–6 / 7–13 / 14 or more days off in the first week that starts after it, then 15 points a week.
 * Null before the first week back.
 */
function rampShare({ start, end }: TimeOutDays, weekStart: string) {
  if (end == null || end >= weekStart) return null;
  const daysOff = daysTo(start, end) + 1;
  const first = daysOff >= 14 ? 0.4 : daysOff >= 7 ? 0.6 : 0.8;
  return Math.round((first + RAMP_STEP * Math.floor((daysTo(end, weekStart) - 1) / 7)) * 100) / 100;
}

describe("coach plan property guard", () => {
  it("never sets a weekly floor above the largest valid week", () => {
    const broken: string[] = [];
    for (const item of athletes()) {
      const { ctx } = item;
      for (const week of ctx.weeks) {
        for (const sport of plannedSports(ctx.availability)) {
          const floor = weekFloor(week, ctx, sport);
          if (floor == null) continue;
          // The largest valid week: every session available, equal (so the long session's share
          // holds), each at the longest rule 2 and the time cap allow, and the budget's 5 % over.
          const longest = Math.min(
            timeCap(sport, ctx),
            longestAllowed(week.weekStart, sport, ctx, []).limit,
          );
          const largest = Math.min(
            week[BUDGET_KEY[sport]] * 1.05,
            sessionsAvailable(week, ctx, sport) * longest,
          );
          if (floor > largest + 1e-6) {
            broken.push(
              `${label(item)}: ${sport} week ${week.weekStart} floor ${floor} > ${largest}`,
            );
          }
        }
      }
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });

  it("cuts a week a time out overlaps to its share of days, and none above what it would have held", () => {
    const broken: string[] = [];
    for (const item of athletes()) {
      item.ctx.weeks.forEach((week, index) => {
        const before = item.before[index]!;
        const days = daysOutside(week.weekStart, item.timeOuts);
        // The weeks before every time out are budgeted as they were without them.
        const untouched = item.timeOuts.every((timeOut) => timeOut.start > week.weekStart);
        for (const { id: sport } of PLAN_SPORTS) {
          const key = BUDGET_KEY[sport];
          const ok =
            week[key] <= (before[key] * days) / 7 + 1e-6 &&
            (!untouched || days < 7 || week[key] === before[key]);
          if (!ok) {
            broken.push(
              `${label(item)}: ${sport} week ${week.weekStart}, ${days} days outside ${JSON.stringify(item.timeOuts)}: ${before[key]} → ${week[key]}`,
            );
          }
        }
      });
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });

  it("ramps back up after a time out on the season it would have had: its share, then 15 points a week", () => {
    const broken: string[] = [];
    for (const item of athletes()) {
      const [timeOut] = item.timeOuts;
      if (!timeOut) continue;
      /** The week's ramp share, and its share of the level without the time out. */
      const at = (index: number) => {
        const week = item.ctx.weeks[index];
        if (!week || daysOutside(week.weekStart, item.timeOuts) < 7) return null;
        const ramp = rampShare(timeOut, week.weekStart);
        return ramp == null ? null : { ramp: Math.min(1, ramp), share: item.shares[index]! };
      };
      item.ctx.weeks.forEach((week, index) => {
        const now = at(index);
        if (!now) return;
        const kept = Math.min(now.ramp, now.share);
        for (const { id: sport } of PLAN_SPORTS) {
          const key = BUDGET_KEY[sport];
          const step = ROUND_TO[sport];
          const before = item.before[index]![key];
          const fail = (why: string) =>
            broken.push(
              `${label(item)}: ${sport} week ${week.weekStart} at ramp ${now.ramp}, share ${now.share} ${why}, ${JSON.stringify(item.timeOuts)}: ${before} → ${week[key]}`,
            );
          // Its share of what the week would have held, give or take both roundings; a week the
          // ramp doesn't cut is exactly as it would have been. Growth runs on underneath either way.
          const expected = (before * kept) / now.share;
          if (
            kept === now.share ? week[key] !== before : Math.abs(week[key] - expected) > step + 1
          ) {
            fail(`not at its share (${expected.toFixed(1)})`);
          }
          // Points of the level the week would have had: none climbs more than 15 over a week the
          // ramp cut, the step onto the first full week included. A lighter week the ramp didn't
          // cut steps back up as the season does.
          const then = at(index - 1);
          const previous = item.before[index - 1]?.[key] ?? 0;
          if (!then || then.ramp >= then.share || before === 0 || previous === 0) continue;
          const level = before / now.share;
          const lastLevel = previous / then.share;
          const jump = week[key] / level - item.ctx.weeks[index - 1]![key] / lastLevel;
          const slack = (step + 1) / level + (step + 1) / lastLevel;
          if (jump > RAMP_STEP + slack + 1e-9)
            fail(`${Math.round(jump * 100)} points over the week before`);
        }
      });
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });

  it("gets a plan from the mock coach that passes every rule", () => {
    const broken: string[] = [];
    for (const item of athletes()) {
      const sessions = mockCoachPlan(item.ctx, item.anchors.paces).map((session) =>
        plannedSession(session, item.anchors, "id"),
      );
      const breaks = checkPlan(sessions, item.ctx);
      if (breaks.length) broken.push(`${label(item)}: ${breaks[0]!.message}`);
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });

  it("keeps easy slower than marathon, and marathon slower than threshold", () => {
    const r = random(204);
    const broken: string[] = [];
    for (let index = 0; index < PACE_CASES; index += 1) {
      // Up to 76: from about 76.7, a world-class marathoner's, the marathon range's fast end
      // runs into threshold's slow end by a few seconds (#223). Widen to 90 when it's fixed.
      const vdot = r.between(20, 76);
      // Zone 2 found anywhere from far too fast to far too slow, or not at all.
      const fast = r.int(150, 520);
      const paces = trainingPaces({
        settings: { from: "automatic", effort: null, easyFrom: r.pick(["heartRate", "vdot"]) },
        raceResult: null,
        estimate: { vdot, from: EFFORT, capped: false, targetMetres: 10_000 },
        choices: [],
        heart:
          r.next() < 0.2
            ? { kind: "zones-missing" }
            : {
                kind: "zone2",
                minBpm: 120,
                maxBpm: 140,
                minutes: 90,
                range: { fastSecPerKm: fast, slowSecPerKm: fast + r.int(0, 60) },
              },
        now: NOW,
      });
      if (paces.source === "none") continue;
      const { easy, marathon, threshold } = paces.paces;
      if (
        easy.fastSecPerKm < marathon.slowSecPerKm ||
        marathon.fastSecPerKm < threshold.slowSecPerKm
      ) {
        broken.push(`VDOT ${vdot}: ${JSON.stringify({ easy, marathon, threshold })}`);
      }
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });

  it("never lowers the pace estimate for adding slower runs", () => {
    const r = random(161);
    const broken: string[] = [];
    for (let index = 0; index < PACE_CASES; index += 1) {
      // Two to six hard runs, each with best efforts at a few race distances from 5 km up...
      const hard = Array.from({ length: r.int(2, 6) }, (_, run) =>
        effortsOf(`hard-${run}`, r.between(32, 70), r.int(0, 15), r),
      ).flat();
      const before = estimateVdot(hard, NOW, r.pick(RACE_DISTANCES));
      if (!before) continue;
      // ...then easy runs, long and short, each slower than every hard run's best.
      const weakest = Math.min(
        ...hard.map((effort) => vdotFromRace(effort.metres, effort.seconds)),
      );
      const slow = Array.from({ length: r.int(1, 8) }, (_, run) =>
        effortsOf(`easy-${run}`, weakest * r.between(0.6, 0.8), 0, r),
      ).flat();
      const after = estimateVdot([...hard, ...slow], NOW, before.targetMetres);
      if (!after || after.vdot < before.vdot - 0.1) {
        broken.push(`target ${before.targetMetres}: ${before.vdot} → ${after?.vdot}`);
      }
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });
});

const NOW = new Date("2027-01-04T12:00:00Z");
const EFFORT: RunEffort = {
  activityId: "1",
  name: "Run",
  start: NOW.toISOString(),
  metres: 10_000,
  seconds: 2700,
};

/** One run's best efforts at a run of `vdot`, at 5 km and some longer race distances. */
function effortsOf(activityId: string, vdot: number, weeksOld: number, r: Random): RunEffort[] {
  const start = new Date(NOW.getTime() - weeksOld * 7 * 86_400_000).toISOString();
  const longest = r.int(2, RACE_DISTANCES.length - 1);
  return RACE_DISTANCES.slice(1, longest + 1).map((metres) => ({
    activityId,
    name: activityId,
    start,
    metres,
    // A run's longer efforts are a little slower than its best, as in a real run's pace profile.
    seconds: predictRaceSeconds(vdot * (metres === 5000 ? 1 : r.between(0.97, 1)), metres),
  }));
}
