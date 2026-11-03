import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import { ATL_DAYS, CTL_DAYS } from "./training-load.ts";
import { addDayKey } from "./day-key.ts";
import {
  anchorEvent,
  daysBetween,
  eventPriority,
  seasonEvents,
  type Goal,
  type GoalPriority,
} from "./season.types.ts";

export const PHASES = {
  hold: { label: "Hold", hint: "No goal ahead: keep fitness where it is." },
  base: { label: "Base", hint: "Unhurried volume, mostly easy, a long session that grows." },
  build: { label: "Build", hint: "Fitness rises toward the goal with race-specific sessions." },
  maintain: {
    label: "Maintain",
    hint: "The last goal was close: hold fitness, then peak again.",
  },
  peak: { label: "Peak", hint: "The longest and most race-like weeks." },
  taper: { label: "Taper", hint: "Less volume so form turns fresh for race day." },
  race: { label: "Race week", hint: "Short and sharp; arrive fresh." },
  recovery: { label: "Recovery", hint: "Easy days after the race. No hard sessions." },
} as const;

/** Hint for a lighter week, whatever the phase. */
export const LIGHTER_HINT = "A lighter week so the last three weeks of work sink in.";

export type PhaseKind = keyof typeof PHASES;

/** Weeks before the goal week at which each phase starts. */
export const BASE_WEEKS = 12;
export const PEAK_WEEKS = 3;
/** A goal finished this recently leaves no room to rebuild before the next one. */
export const REBUILD_WEEKS = 8;
/** Every this many weeks before the peak, a lighter week (ADR 0024). */
export const LIGHTER_EVERY_WEEKS = 4;
/** Share of the usual week a lighter week keeps. */
export const LIGHTER_LOAD_FACTOR = 0.7;
/** Days after an A goal during which the plan does not ramp, whatever comes next. */
export const NO_RAMP_AFTER_A_DAYS = 13;
/** The week target never asks for more than this times the recent weeks' load (rampBaseLoad). */
export const MAX_RAMP_RATIO = 1.1;

export type SeasonPhase = {
  kind: PhaseKind;
  /** The goals the week works toward (one event: several for a same-day multisport race). */
  anchor: Goal[];
  /** Days from the start of the week to the anchor. */
  daysToAnchor: number | null;
  /** The anchor event's priority: how fast fitness rises (ADR 0049). */
  priority: GoalPriority | null;
  /** A lighter week inside a build: less load. */
  lighter: boolean;
  /**
   * How the week's load moves: a ramp in fitness per week, or a share of
   * the week's usual load when volume drops.
   */
  ramp: number;
  loadFactor: number | null;
};

/** The athlete's usual speed and climbing per sport group, from recent activities. */
export type GroupPace = { kmh: number; climbPerKm: number };

const RAMP: Record<"base" | "build" | "peak", Record<GoalPriority, number>> = {
  base: { C: 3, B: 3, A: 5 },
  build: { C: 3, B: 5, A: 7 },
  peak: { C: 3, B: 5, A: 5 },
};

const HOLD: SeasonPhase = {
  kind: "hold",
  anchor: [],
  daysToAnchor: null,
  priority: null,
  lighter: false,
  ramp: 0,
  loadFactor: null,
};

/**
 * The week's phase from the season, read at the start of the week so it holds all week.
 * The plan builds toward the next A event (else the next B one) (ADR 0024).
 */
export function seasonPhase(goals: Goal[], weekStart: string): SeasonPhase {
  const events = seasonEvents(goals);
  const ahead = events.filter((event) => daysBetween(weekStart, event.date) >= 0);
  const lastA = events
    .filter((event) => daysBetween(weekStart, event.date) < 0 && eventPriority(event) === "A")
    .at(-1);
  const sinceLast = lastA ? -daysBetween(weekStart, lastA.date) : null;
  const justRaced = sinceLast != null && sinceLast <= 7;

  const anchorAhead = anchorEvent(ahead);
  if (!anchorAhead) return justRaced ? recoveryPhase(lastA!.goals) : HOLD;
  const anchor = anchorAhead.goals;
  const priority = eventPriority(anchorAhead);
  const anchorIsA = priority === "A";
  const daysToAnchor = daysBetween(weekStart, anchorAhead.date);
  const weeksLeft = Math.floor(daysToAnchor / 7);

  let phase: SeasonPhase;
  if (justRaced) {
    phase = recoveryPhase(lastA!.goals);
  } else if (weeksLeft === 0) {
    phase = {
      ...HOLD,
      kind: "race",
      // A B goal leading the season gets a few lighter days, not a full taper.
      loadFactor: anchorIsA ? 0.5 : 0.85,
    };
  } else if (weeksLeft === 1 && anchorIsA) {
    phase = {
      ...HOLD,
      kind: "taper",
      loadFactor: 0.75,
    };
  } else if (weeksLeft <= PEAK_WEEKS) {
    phase = {
      ...HOLD,
      kind: "peak",
      ramp: RAMP.peak[priority],
    };
  } else if (weeksLeft <= BASE_WEEKS) {
    const rebuilding = sinceLast != null && sinceLast + daysToAnchor < REBUILD_WEEKS * 7;
    phase = rebuilding
      ? { ...HOLD, kind: "maintain" }
      : {
          ...HOLD,
          kind: "build",
          ramp: RAMP.build[priority],
        };
  } else {
    phase = {
      ...HOLD,
      kind: "base",
      ramp: RAMP.base[priority],
    };
  }

  // Right after an A goal the body is still recovering: hold, however close the next one is.
  if (
    sinceLast != null &&
    sinceLast <= NO_RAMP_AFTER_A_DAYS &&
    (phase.kind === "base" || phase.kind === "build" || phase.kind === "peak")
  ) {
    phase = { ...phase, kind: "maintain", ramp: 0 };
  }

  // Every fourth week before the peak is lighter, counted back from the goal so the
  // last one lands just before the peak weeks.
  const lighter =
    (phase.kind === "base" || phase.kind === "build") &&
    weeksLeft > PEAK_WEEKS &&
    weeksLeft % LIGHTER_EVERY_WEEKS === 0;
  if (lighter) {
    phase = {
      ...phase,
      lighter: true,
      ramp: 0,
      loadFactor: LIGHTER_LOAD_FACTOR,
    };
  }

  return { ...phase, anchor, daysToAnchor, priority };
}

function recoveryPhase(raced: Goal[]): SeasonPhase {
  return {
    ...HOLD,
    kind: "recovery",
    anchor: raced,
    priority: "A",
    loadFactor: 0.6,
  };
}

/** Days of activities that set the athlete's usual pace for a goal. */
const PACE_DAYS = 120;

/** Usual speed and climbing per sport group, from recent activities that recorded distance. */
export function recentPaces(
  rows: {
    sportType: string;
    startDate: Date;
    movingTime: number;
    distance: number | null;
    totalElevationGain: number | null;
  }[],
  now: Date,
): Partial<Record<SportGroupId, GroupPace>> {
  const since = now.getTime() - PACE_DAYS * 86_400_000;
  const totals = new Map<SportGroupId, { km: number; hours: number; climb: number }>();
  for (const row of rows) {
    const group = sportGroupFor(row.sportType)?.id;
    if (!group || !row.distance || row.movingTime <= 0 || row.startDate.getTime() < since) continue;
    // Indoor sessions have no real distance or climbing to learn a pace from.
    if (row.sportType.startsWith("Virtual")) continue;
    const total = totals.get(group) ?? { km: 0, hours: 0, climb: 0 };
    total.km += row.distance / 1000;
    total.hours += row.movingTime / 3600;
    total.climb += row.totalElevationGain ?? 0;
    totals.set(group, total);
  }
  const paces: Partial<Record<SportGroupId, GroupPace>> = {};
  for (const [group, total] of totals) {
    if (total.hours < 1 || total.km <= 0) continue;
    paces[group] = { kmh: total.km / total.hours, climbPerKm: total.climb / total.km };
  }
  return paces;
}

/** Minutes per 100 m of climbing beyond what the athlete's usual sessions climb. */
const CLIMB_MINUTES_PER_100M: Record<SportGroupId, number> = {
  cycling: 6,
  running: 10,
  walking: 15,
  swimming: 0,
};
/** The goal's duration at the athlete's own pace, or null without a usable pace. */
export function expectedGoalMinutes(
  goal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">,
  pace: GroupPace | undefined,
) {
  const group = sportGroupFor(goal.sportType)?.id;
  if (!group || goal.distanceM == null || !pace || pace.kmh <= 0) return null;
  const km = goal.distanceM / 1000;
  const extraClimb = Math.max(0, (goal.elevationGainM ?? 0) - pace.climbPerKm * km);
  return Math.round((km / pace.kmh) * 60 + (extraClimb / 100) * CLIMB_MINUTES_PER_100M[group]);
}

/** The phase's ramp, eased off when form is already low. */
export function rampFor(ramp: number, form: number) {
  if (form < -30) return Math.min(ramp, 0);
  if (form < -18) return Math.min(ramp, 5);
  if (form < -10) return Math.min(ramp, 8);
  return ramp;
}

export type WeekLoad = {
  load: number;
  /** Which guardrail held the phase back, if any (ADR 0024). */
  limitedBy: "ramp-cap" | "form" | null;
};

/**
 * A week's training load from fitness and fatigue at its start, as the week target sets it.
 * The phase's ramp is capped by form and by the last four weeks' average load, but never below
 * what holds fitness where it is.
 */
export function phaseWeekLoad(
  phase: Pick<SeasonPhase, "ramp" | "loadFactor">,
  fitness: { ctl: number; atl: number },
  recentAverageLoad: number | null = null,
): WeekLoad {
  const { ctl, atl } = fitness;
  const hold = 7 * ctl;
  if (phase.loadFactor != null) return { load: hold * phase.loadFactor, limitedBy: null };
  const ramp = rampFor(phase.ramp, ctl - atl);
  const wanted = Math.max(0, hold + CTL_DAYS * ramp);
  const formLimited = ramp < phase.ramp;
  if (recentAverageLoad != null && recentAverageLoad > 0) {
    const cap = Math.max(hold, recentAverageLoad * MAX_RAMP_RATIO);
    if (wanted > cap) return { load: cap, limitedBy: "ramp-cap" };
  }
  return { load: wanted, limitedBy: formLimited ? "form" : null };
}

/**
 * The load the ramp cap grows from: the average of the last four weeks without the lightest, so
 * a lighter week or a missed one does not hold the next build back.
 */
export function rampBaseLoad(weekLoads: number[]): number | null {
  const recent = weekLoads.slice(-4);
  if (!recent.length || recent.every((load) => load <= 0)) return null;
  const kept = recent.length > 3 ? [...recent].sort((a, b) => b - a).slice(0, 3) : recent;
  return kept.reduce((sum, load) => sum + load, 0) / kept.length;
}

/** Loads of the `weeks` whole weeks before `weekStart`, oldest first; empty without any. */
export function weekLoadsBefore(
  days: { date: string; load: number }[],
  weekStart: string,
  weeks = 4,
): number[] {
  const loads = Array.from({ length: weeks }, () => 0);
  const from = addDayKey(weekStart, -7 * weeks);
  for (const day of days) {
    if (day.date < from || day.date >= weekStart) continue;
    const index = Math.floor(daysBetween(from, day.date) / 7);
    loads[index]! += day.load;
  }
  return loads.some((load) => load > 0) ? loads : [];
}

export function mondayOf(key: string) {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDayKey(key, -((weekday + 6) % 7));
}

/** One week of the season: its phase, and whether it is a lighter week. */
export type SeasonWeek = { weekStart: string; phase: PhaseKind; lighter: boolean };

/** The season week by week, from the week of `fromDay` through the week of `toDay`. */
export function seasonWeeks(goals: Goal[], fromDay: string, toDay: string): SeasonWeek[] {
  const weeks: SeasonWeek[] = [];
  for (let week = mondayOf(fromDay); week <= toDay; week = addDayKey(week, 7)) {
    const phase = seasonPhase(goals, week);
    weeks.push({ weekStart: week, phase: phase.kind, lighter: phase.lighter });
  }
  return weeks;
}

/**
 * Fitness, fatigue, and form on the morning of `goalDate` if every week from tomorrow hits its
 * week target, load spread evenly over the days. A guide to the taper, not a prediction.
 */
export function projectRaceDay(
  fitness: { ctl: number; atl: number },
  goals: Goal[],
  today: string,
  goalDate: string,
  recentWeekLoads: number[] = [],
) {
  let { ctl, atl } = fitness;
  let dailyLoad = 0;
  const loads = [...recentWeekLoads];
  for (let day = addDayKey(today, 1); day < goalDate; day = addDayKey(day, 1)) {
    const weekStart = mondayOf(day);
    if (day === weekStart || day === addDayKey(today, 1)) {
      const { load } = phaseWeekLoad(
        seasonPhase(goals, weekStart),
        { ctl, atl },
        rampBaseLoad(loads),
      );
      dailyLoad = load / 7;
      if (day === weekStart) loads.push(load);
    }
    ctl += (dailyLoad - ctl) / CTL_DAYS;
    atl += (dailyLoad - atl) / ATL_DAYS;
  }
  return { ctl, atl, form: ctl - atl };
}
