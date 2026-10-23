import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import { ATL_DAYS, CTL_DAYS } from "./training-load.ts";
import {
  addDayKey,
  isKeySport,
  sportFamilyOf,
  type BuildPace,
  type KeySport,
  type SportFamily,
} from "./training-plan.types.ts";
import {
  anchorEvent,
  daysBetween,
  eventPriority,
  roughGoalHours,
  seasonEvents,
  type Goal,
  type GoalObjective,
} from "./season.types.ts";

export const PHASES = {
  hold: { label: "Hold", hint: "No goal ahead: keep fitness where it is." },
  base: { label: "Base", hint: "Unhurried volume, mostly easy, a long session that grows." },
  build: { label: "Build", hint: "Fitness rises toward the goal with race-specific key sessions." },
  maintain: {
    label: "Maintain",
    hint: "The last goal was close: hold fitness, then peak again.",
  },
  peak: { label: "Peak", hint: "The longest and most race-like weeks." },
  taper: { label: "Taper", hint: "Less volume so form turns fresh for race day." },
  race: { label: "Race week", hint: "Short and sharp; arrive fresh." },
  recovery: { label: "Recovery", hint: "Easy days after the race. No key sessions." },
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
  objective: GoalObjective | null;
  /** A B goal (not the anchor) falls this week: a few lighter days and one key session. */
  tuneUp: Goal[];
  /** C goals this week: trained through. */
  trainThrough: Goal[];
  /** A lighter week inside a build: less load and one key session. */
  lighter: boolean;
  /**
   * How the week target moves: a ramp in fitness per week, or a share of
   * the week's usual load when volume drops.
   */
  ramp: number;
  loadFactor: number | null;
  /** Which key session types lead (see KEY_ROTATION in week-target.ts). */
  rotation: BuildPace;
  /** At most this many key sessions this week, whatever the week mix says. */
  maxKeySessions: number | null;
  /** Where the week's time should go by sport family, before blending with the athlete's history. */
  goalShares: Record<SportFamily, number> | null;
  /** How much goalShares weighs against the athlete's own split (0–1). */
  goalWeight: number;
  /** Shaped by the goal's sport, distance, and climbing; null without a goal to shape toward. */
  sessions: GoalSessions | null;
};

export type GoalSessions = {
  /** The sport the main key session and the long session go on. */
  keySport: KeySport;
  /** The goal's expected duration at the athlete's own pace. */
  expectedMinutes: number | null;
  /** This week's long session, a growing share of the goal's expected time. */
  longMinutes: number | null;
  /** Climbing to put into the long session, in proportion to the goal's. */
  longClimbM: number | null;
  /** The goal climbs enough that intervals belong on a hill. */
  hilly: boolean;
};

/** The athlete's usual speed and climbing per sport group, from recent activities. */
export type GroupPace = { kmh: number; climbPerKm: number };

const RAMP: Record<"base" | "build" | "peak", Record<GoalObjective, number>> = {
  base: { finish: 3, finishWell: 3, perform: 5 },
  build: { finish: 3, finishWell: 5, perform: 7 },
  peak: { finish: 3, finishWell: 5, perform: 5 },
};

const ROTATION: Record<"base" | "build" | "peak" | "sharpen", Record<GoalObjective, BuildPace>> = {
  base: { finish: "hold", finishWell: "hold", perform: "slow" },
  build: { finish: "slow", finishWell: "steady", perform: "fast" },
  peak: { finish: "steady", finishWell: "steady", perform: "overreach" },
  sharpen: { finish: "steady", finishWell: "fast", perform: "fast" },
};

const HOLD: SeasonPhase = {
  kind: "hold",
  anchor: [],
  daysToAnchor: null,
  objective: null,
  tuneUp: [],
  trainThrough: [],
  lighter: false,
  ramp: 0,
  loadFactor: null,
  rotation: "hold",
  maxKeySessions: null,
  goalShares: null,
  goalWeight: 0,
  sessions: null,
};

/** Share of time per sport family across goals, weighted by their rough duration. */
export function goalFamilyShares(goals: Goal[]): Record<SportFamily, number> | null {
  const hours: Record<SportFamily, number> = { running: 0, cycling: 0, other: 0 };
  for (const goal of goals) hours[sportFamilyOf(goal.sportType)] += roughGoalHours(goal) || 1;
  const total = hours.running + hours.cycling + hours.other;
  if (total <= 0) return null;
  return {
    running: hours.running / total,
    cycling: hours.cycling / total,
    other: hours.other / total,
  };
}

/** The more demanding objective wins when a multisport event mixes them. */
function objectiveOf(goals: Goal[]): GoalObjective {
  if (goals.some((goal) => goal.objective === "perform")) return "perform";
  if (goals.some((goal) => goal.objective === "finishWell")) return "finishWell";
  return "finish";
}

/**
 * The week's phase from the season, read at the start of the week so it holds all week.
 * The plan builds toward the next A event (else the next B one); B goals ease off their week
 * and C goals are trained through (ADR 0024).
 */
export function seasonPhase(goals: Goal[], weekStart: string): SeasonPhase {
  const events = seasonEvents(goals);
  const ahead = events.filter((event) => daysBetween(weekStart, event.date) >= 0);
  const lastA = events
    .filter((event) => daysBetween(weekStart, event.date) < 0 && eventPriority(event) === "A")
    .at(-1);
  const sinceLast = lastA ? -daysBetween(weekStart, lastA.date) : null;
  const justRaced = sinceLast != null && sinceLast <= 7;
  const thisWeek = (date: string) => daysBetween(weekStart, date) <= 6;
  const trainThrough = ahead
    .filter((event) => thisWeek(event.date) && eventPriority(event) === "C")
    .flatMap((event) => event.goals);

  const anchorAhead = anchorEvent(ahead);
  if (!anchorAhead) {
    return justRaced ? { ...recoveryPhase(lastA!.goals), trainThrough } : { ...HOLD, trainThrough };
  }
  const anchor = anchorAhead.goals;
  const anchorIsA = eventPriority(anchorAhead) === "A";
  const objective = objectiveOf(anchor);
  const daysToAnchor = daysBetween(weekStart, anchorAhead.date);
  const weeksLeft = Math.floor(daysToAnchor / 7);
  const tuneUp = ahead
    .filter(
      (event) => event !== anchorAhead && thisWeek(event.date) && eventPriority(event) === "B",
    )
    .flatMap((event) => event.goals);
  const anchorShares = goalFamilyShares(anchor);
  const seasonShares = goalFamilyShares(
    ahead.filter((event) => eventPriority(event) !== "C").flatMap((event) => event.goals),
  );

  let phase: SeasonPhase;
  if (justRaced) {
    phase = recoveryPhase(lastA!.goals);
  } else if (weeksLeft === 0) {
    phase = {
      ...HOLD,
      kind: "race",
      // A B goal leading the season gets a few lighter days, not a full taper.
      loadFactor: anchorIsA ? 0.5 : 0.85,
      rotation: ROTATION.sharpen[objective],
      maxKeySessions: 1,
    };
  } else if (weeksLeft === 1 && anchorIsA) {
    phase = {
      ...HOLD,
      kind: "taper",
      loadFactor: 0.75,
      rotation: ROTATION.sharpen[objective],
      maxKeySessions: 1,
    };
  } else if (weeksLeft <= PEAK_WEEKS) {
    phase = {
      ...HOLD,
      kind: "peak",
      ramp: RAMP.peak[objective],
      rotation: ROTATION.peak[objective],
    };
  } else if (weeksLeft <= BASE_WEEKS) {
    const rebuilding = sinceLast != null && sinceLast + daysToAnchor < REBUILD_WEEKS * 7;
    phase = rebuilding
      ? { ...HOLD, kind: "maintain", rotation: ROTATION.build[objective] }
      : {
          ...HOLD,
          kind: "build",
          ramp: RAMP.build[objective],
          rotation: ROTATION.build[objective],
        };
  } else {
    phase = {
      ...HOLD,
      kind: "base",
      ramp: RAMP.base[objective],
      rotation: ROTATION.base[objective],
    };
  }

  // Right after an A goal the body is still recovering: hold, however close the next one is.
  if (
    sinceLast != null &&
    sinceLast <= NO_RAMP_AFTER_A_DAYS &&
    (phase.kind === "base" || phase.kind === "build" || phase.kind === "peak")
  ) {
    phase = { ...phase, kind: "maintain", ramp: 0, rotation: ROTATION.build[objective] };
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
      maxKeySessions: 1,
    };
  }

  const early = phase.kind === "base";
  phase = {
    ...phase,
    anchor,
    daysToAnchor,
    objective,
    trainThrough,
    goalShares: early ? seasonShares : anchorShares,
    goalWeight: phase.kind === "recovery" ? 0 : early ? 0.5 : 0.7,
  };
  if (tuneUp.length && phase.kind !== "race" && phase.kind !== "recovery") {
    // A B goal gets a few lighter days before it, not a full taper.
    phase = {
      ...phase,
      tuneUp,
      ramp: Math.min(phase.ramp, 0),
      loadFactor: Math.min(phase.loadFactor ?? 1, 0.85),
      maxKeySessions: Math.min(phase.maxKeySessions ?? 1, 1),
    };
  }
  return phase;
}

function recoveryPhase(raced: Goal[]): SeasonPhase {
  return {
    ...HOLD,
    kind: "recovery",
    anchor: raced,
    objective: objectiveOf(raced),
    loadFactor: 0.6,
    maxKeySessions: 0,
  };
}

/** Blends the athlete's own split toward the goals' sports. */
export function blendShares(
  history: Record<SportFamily, number>,
  phase: Pick<SeasonPhase, "goalShares" | "goalWeight">,
): Record<SportFamily, number> {
  if (!phase.goalShares || phase.goalWeight <= 0) return history;
  const weight = phase.goalWeight;
  const mix = (family: SportFamily) =>
    history[family] * (1 - weight) + phase.goalShares![family] * weight;
  return { running: mix("running"), cycling: mix("cycling"), other: mix("other") };
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
/** Longest long session per sport, whatever the goal: beyond it recovery costs too much. */
const LONG_CAP_MINUTES: Record<KeySport, number> = {
  cycling: 360,
  running: 180,
  walking: 360,
  swimming: 90,
};
const LONG_MIN_MINUTES = 45;
/** Metres of climbing per kilometre from which intervals go on a hill. */
export const HILLY_M_PER_KM = 15;

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

/** Share of the goal's expected time the long session reaches, by phase. */
function longShare(phase: Pick<SeasonPhase, "kind" | "daysToAnchor">) {
  const weeksLeft = Math.floor((phase.daysToAnchor ?? 0) / 7);
  switch (phase.kind) {
    case "base":
      return 0.4;
    case "build": {
      // From half the goal 12 weeks out to three quarters 4 weeks out.
      const progress = (BASE_WEEKS - weeksLeft) / (BASE_WEEKS - PEAK_WEEKS - 1);
      return 0.5 + 0.25 * Math.min(1, Math.max(0, progress));
    }
    case "maintain":
      return 0.6;
    case "peak":
      return 0.8;
    case "taper":
      return 0.4;
    default:
      return null;
  }
}

/** Where the goal puts the week's key sessions: its sport, the long session, and hills. */
export function goalSessions(
  phase: SeasonPhase,
  paces: Partial<Record<SportGroupId, GroupPace>>,
): GoalSessions | null {
  // The longest part of the event leads: the ride of a triathlon, the run of a duathlon.
  const lead = [...phase.anchor]
    .filter((goal) => isKeySport(sportGroupFor(goal.sportType)?.id ?? ""))
    .sort((a, b) => roughGoalHours(b) - roughGoalHours(a))[0];
  const keySport = lead ? (sportGroupFor(lead.sportType)!.id as KeySport) : null;
  if (!lead || !keySport || phase.kind === "recovery" || phase.kind === "hold") return null;
  const expectedMinutes = expectedGoalMinutes(lead, paces[keySport]);
  const share = longShare(phase);
  const longMinutes =
    expectedMinutes != null && share != null
      ? Math.min(
          LONG_CAP_MINUTES[keySport],
          Math.max(LONG_MIN_MINUTES, Math.round((expectedMinutes * share) / 15) * 15),
        )
      : null;
  const climbPerKm =
    lead.distanceM && lead.elevationGainM ? lead.elevationGainM / (lead.distanceM / 1000) : 0;
  const longClimbM =
    longMinutes != null && expectedMinutes && lead.elevationGainM
      ? Math.round((lead.elevationGainM * Math.min(1, longMinutes / expectedMinutes)) / 50) * 50
      : null;
  return {
    keySport,
    expectedMinutes,
    longMinutes,
    longClimbM: longClimbM || null,
    hilly: keySport !== "swimming" && climbPerKm >= HILLY_M_PER_KM,
  };
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

export type ProjectedWeek = {
  weekStart: string;
  phase: SeasonPhase;
  load: number;
  /** Fitness and fatigue at the start of the week. */
  ctl: number;
  atl: number;
};

/**
 * Week targets from `fromWeek` through `toWeek` if the athlete hits every one, load spread evenly
 * over the days. The guardrails apply as they would each Monday. A guide, not a prediction.
 */
export function projectSeason(
  fitness: { ctl: number; atl: number },
  goals: Goal[],
  fromWeek: string,
  toWeek: string,
  recentWeekLoads: number[] = [],
): ProjectedWeek[] {
  let { ctl, atl } = fitness;
  const loads = [...recentWeekLoads];
  const weeks: ProjectedWeek[] = [];
  for (let week = mondayOf(fromWeek); week <= toWeek; week = addDayKey(week, 7)) {
    const phase = seasonPhase(goals, week);
    const { load } = phaseWeekLoad(phase, { ctl, atl }, rampBaseLoad(loads));
    weeks.push({ weekStart: week, phase, load, ctl, atl });
    for (let day = 0; day < 7; day += 1) {
      ctl += (load / 7 - ctl) / CTL_DAYS;
      atl += (load / 7 - atl) / ATL_DAYS;
    }
    loads.push(load);
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
