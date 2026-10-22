import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import {
  isKeySport,
  sportFamilyOf,
  type BuildPace,
  type KeySport,
  type SportFamily,
} from "./training-plan.types.ts";
import {
  daysBetween,
  roughGoalHours,
  seasonClusters,
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

export type PhaseKind = keyof typeof PHASES;

/** Weeks before the goal week at which each phase starts. */
export const BASE_WEEKS = 12;
export const PEAK_WEEKS = 3;
/** A goal finished this recently leaves no room to rebuild before the next one. */
export const REBUILD_WEEKS = 8;

export type SeasonPhase = {
  kind: PhaseKind;
  /** The goals the week works toward (one event: several for a same-day multisport race). */
  anchor: Goal[];
  /** Days from the start of the week to the anchor. */
  daysToAnchor: number | null;
  objective: GoalObjective | null;
  /** A goal that is not the main one falls this week: a short taper and fewer key sessions. */
  tuneUp: Goal[];
  /**
   * How the week target moves: a ramp in fitness per week (as build pace did), or a share of
   * the week's usual load when volume drops.
   */
  ramp: number;
  loadFactor: number | null;
  /** Which key session types lead (the build pace rotations). */
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
  build: { finish: 3, finishWell: 5, perform: 8 },
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
 * Goals are worked toward in date order; within a cluster the plan peaks for the main event.
 */
export function seasonPhase(goals: Goal[], weekStart: string): SeasonPhase {
  const ahead = goals.filter((goal) => daysBetween(weekStart, goal.date) >= 0);
  // Clusters over every goal, so a tune-up just done before an upcoming main race is no main.
  const lastMain = mainGoalsOf(goals)
    .filter((goal) => daysBetween(weekStart, goal.date) < 0)
    .at(-1);
  const sinceLast = lastMain ? -daysBetween(weekStart, lastMain.date) : null;
  const justRaced = sinceLast != null && sinceLast <= 7;

  const [cluster] = seasonClusters(ahead);
  if (!cluster) {
    return justRaced ? recoveryPhase([lastMain!]) : HOLD;
  }
  const mainEvent = cluster.events.find((event) => event.date === cluster.mainDate)!;
  const anchor = mainEvent.goals;
  const objective = objectiveOf(anchor);
  const daysToAnchor = daysBetween(weekStart, mainEvent.date);
  const weeksLeft = Math.floor(daysToAnchor / 7);
  const tuneUp = cluster.events
    .filter((event) => event.date !== mainEvent.date)
    .filter((event) => daysBetween(weekStart, event.date) <= 6)
    .flatMap((event) => event.goals);
  const anchorShares = goalFamilyShares(anchor);
  const seasonShares = goalFamilyShares(ahead);

  let phase: SeasonPhase;
  if (justRaced) {
    phase = recoveryPhase([lastMain!]);
  } else if (weeksLeft === 0) {
    phase = {
      ...HOLD,
      kind: "race",
      loadFactor: 0.5,
      rotation: ROTATION.sharpen[objective],
      maxKeySessions: 1,
    };
  } else if (weeksLeft === 1) {
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

  const early = phase.kind === "base";
  phase = {
    ...phase,
    anchor,
    daysToAnchor,
    objective,
    goalShares: early ? seasonShares : anchorShares,
    goalWeight: phase.kind === "recovery" ? 0 : early ? 0.5 : 0.7,
  };
  if (tuneUp.length && phase.kind !== "race" && phase.kind !== "recovery") {
    // A tune-up gets a few lighter days before it, not a full taper.
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

/** Goals that were the main event of their cluster, in date order. */
function mainGoalsOf(goals: Goal[]): Goal[] {
  return seasonClusters(goals).flatMap(
    (cluster) => cluster.events.find((event) => event.date === cluster.mainDate)?.goals ?? [],
  );
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
