import { createServerFn } from "@tanstack/react-start";

import { emptyHistogram, zonesFromHistogram } from "./heart-rate.ts";
import { ATL_DAYS, CTL_DAYS, formLabel } from "./training-load.ts";
import {
  blendShares,
  phaseWeekLoad,
  rampBaseLoad,
  weekLoadsBefore,
  type GoalSessions,
  type SeasonPhase,
} from "./season-phase.ts";
import { isOtherSportType, sportGroupFor } from "./sport-groups.ts";
import {
  DEFAULT_LOAD_PER_HOUR,
  KEY_SESSION_PRESETS,
  COOL_DOWN_MINUTES,
  NO_HISTORY_MINUTES_PER_DAY,
  WARM_UP_MINUTES,
  formatHours,
  keySessionCountFor,
  keySessionFromPreset,
  keySessionMinutes,
  keySessionName,
  keySessionWorkMinutes,
  zoneLabel,
  type BuildPace,
  type FamilyCollectors,
  type KeySession,
  type KeySessionPresetId,
  type KeySport,
  type PlanningAnchors,
  type SportFamily,
  type TargetZone,
  type TrainingPlan,
  trainingDayCount,
} from "./training-plan.types.ts";
import type { Goal } from "./season.types.ts";
import type { WeekAhead } from "./week-plan.ts";

/** Complete weeks before this one used for the usual pace, sport split, and ramp check. */
export const HISTORY_WEEKS = 8;
/** A finished week above this many times the last-4-week load is flagged. */
export const RAMP_WARNING_RATIO = 1.3;

/** A key session counts as done once this share of its target-zone time is reached. */
export const KEY_SESSION_DONE_SHARE = 0.8;
/** Below this form, key sessions are paused for the week. */
export const PAUSE_FORM = -30;

export type WeekActivity = {
  id: string;
  title: string;
  date: string;
  sportType: string;
  family: SportFamily;
  minutes: number;
  load: number;
  /** Minutes at tempo or above (heart-rate zone 3+). */
  hardMinutes: number;
  hardSource: "heartRate" | "estimate";
  /** Minutes in heart-rate zones 1–5, or null without a heart-rate stream. */
  zoneMinutes: number[] | null;
};

export type DayTotal = {
  date: string;
  family: SportFamily;
  minutes: number;
  load: number;
};

export type FitnessPoint = { ctl: number; atl: number };

export type WeekTargetData = {
  signedIn: boolean;
  plan: TrainingPlan | null;
  today: string;
  weekStart: string;
  activities: WeekActivity[];
  history: DayTotal[];
  /** Fitness and fatigue at the start of Monday; keeps an auto target steady all week. */
  weekStartFitness: FitnessPoint;
  /** Fitness and fatigue at the end of today, after today's copied activities. */
  fitness: FitnessPoint;
  collectors: Record<KeySport, FamilyCollectors>;
  anchors: PlanningAnchors;
  /** Where the season puts this week; read at the start of the week like the target. */
  season: SeasonPhase;
  /** Goals of the plan from a few days before the week to a few after: their days shape it. */
  nearbyGoals: Goal[];
};

export type WeekTarget = {
  minutes: number;
  load: number;
  /**
   * auto: fitness and the phase; ramp-cap / form: a guardrail held the phase back (ADR 0024);
   * baseline: growing from the athlete's starting point after a break; no-history: 45 minutes
   * per training day until VO2 has history (ADR 0026).
   */
  source: "auto" | "ramp-cap" | "form" | "baseline" | "no-history";
};

export type WeekSummary = {
  target: WeekTarget;
  doneMinutes: number;
  doneLoad: number;
  remainingMinutes: number;
  remainingLoad: number;
  shares: Record<SportFamily, number>;
  /** Running time was held to the athlete's recent running plus 15 % (ADR 0024). */
  runCapped: boolean;
  bySport: Record<SportFamily, { done: number; left: number }>;
  keySessions: KeySessionStatus[];
  /** Key sessions are paused when form is very low. */
  paused: boolean;
  loadPerHour: number;
  form: number;
  trainingDays: number;
};

export type KeySessionStatus = {
  session: KeySession;
  minutes: number;
  done: WeekActivity | null;
  /** The sport VO2 suggests for this session, and whether the athlete picked another. */
  suggestedSport: KeySport;
  sportPinned: boolean;
};

export type SessionKind = "rest" | "recovery" | "easy" | "key" | "race";

export type Recommendation = {
  kind: SessionKind;
  keySession: KeySession | null;
  /** Sport of the main part. */
  family: PartSport;
  /** Minutes of the main part. */
  minutes: number;
  /** Today in order: the main part and any easy parts before or after it. */
  parts: DayPart[];
  title: string;
  description: string;
  reasons: string[];
  /** What the athlete's own choice costs, when it goes against what VO2 would pick. */
  warnings: string[];
  load: number;
  after: {
    remainingMinutes: number;
    formTomorrow: number;
    formTomorrowLabel: string;
    fitnessChange: number;
  };
};

export type WeekProjection = {
  fitnessNow: number;
  fitnessSunday: number;
  formMonday: number;
  formMondayLabel: string;
};

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function round5(minutes: number) {
  return Math.max(0, Math.round(minutes / 5) * 5);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function stress(minutes: number, intensity: number) {
  return (minutes / 60) * 100 * intensity * intensity;
}

/** Hard minutes when an activity has no heart-rate stream: from its load per hour. */
export function estimatedHardMinutes(minutes: number, load: number) {
  if (minutes <= 0 || load <= 0) return 0;
  const intensity = Math.sqrt(load / ((minutes / 60) * 100));
  return Math.round(minutes * clamp((intensity - 0.75) / 0.2, 0, 1));
}

export function recentLoadPerHour(history: DayTotal[]) {
  let minutes = 0;
  let load = 0;
  for (const day of history) {
    minutes += day.minutes;
    load += day.load;
  }
  if (minutes < 120 || load <= 0) return DEFAULT_LOAD_PER_HOUR;
  return clamp(load / (minutes / 60), 25, 90);
}

/** Weekly growth from the athlete's starting point after a break. */
export const BASELINE_GROWTH = 1.1;

/**
 * The week's hours from the season phase and fitness at the start of Monday. Without history,
 * 45 minutes per training day (or the athlete's starting point); after a break, the starting
 * point grows by at most 10 % a week until fitness asks for less (ADR 0026).
 */
export function weeklyTarget(input: {
  plan: Pick<TrainingPlan, "restWeekdays" | "baselineMinutes" | "startWeek">;
  season: Pick<SeasonPhase, "ramp" | "loadFactor">;
  weekStartFitness: FitnessPoint;
  loadPerHour: number;
  weekStart: string;
  /** Recent weekly load the ramp cap grows from (rampBaseLoad); null without history. */
  recentAverageLoad?: number | null;
}): WeekTarget {
  const { plan, season, loadPerHour } = input;
  const { ctl, atl } = input.weekStartFitness;
  const fromMinutes = (minutes: number, source: WeekTarget["source"]): WeekTarget => ({
    minutes,
    load: Math.round((minutes / 60) * loadPerHour),
    source,
  });
  if (ctl <= 5) {
    const start = plan.baselineMinutes ?? trainingDayCount(plan) * NO_HISTORY_MINUTES_PER_DAY;
    return fromMinutes(round5(start * (season.loadFactor ?? 1)), "no-history");
  }
  const { load, limitedBy } = phaseWeekLoad(season, { ctl, atl }, input.recentAverageLoad ?? null);
  const hours = clamp(Math.round((load / loadPerHour) * 4) / 4, 0.5, 30);
  const minutes = Math.round(hours * 60);
  if (plan.baselineMinutes != null && plan.startWeek) {
    const weeks = Math.max(0, Math.round(daysBetween(plan.startWeek, input.weekStart) / 7));
    const cap = round5(plan.baselineMinutes * BASELINE_GROWTH ** weeks * (season.loadFactor ?? 1));
    if (cap < minutes) return fromMinutes(cap, "baseline");
  }
  return { minutes, load: Math.round(load), source: limitedBy ?? "auto" };
}

export function sportShares(history: DayTotal[]): Record<SportFamily, number> {
  const minutes: Record<SportFamily, number> = { running: 0, cycling: 0, other: 0 };
  for (const day of history) minutes[day.family] += day.minutes;
  const total = minutes.running + minutes.cycling + minutes.other;
  if (total < 60) return { running: 0.5, cycling: 0.5, other: 0 };
  return {
    running: minutes.running / total,
    cycling: minutes.cycling / total,
    other: minutes.other / total,
  };
}

/** Shortest easy session worth planning, by the sport most of the week is on. */
export const EASY_MIN_RIDE = 45;
export const EASY_MIN_RUN = 30;
/** Running grows at most this much above the athlete's recent weekly running. */
export const RUN_GROWTH = 1.15;

/**
 * Holds running time to the athlete's recent weekly running plus 15 %: impact load adapts slower
 * than fitness. The rest goes to riding when the athlete rides, else to other sports.
 */
export function capRunShare(
  shares: Record<SportFamily, number>,
  history: DayTotal[],
  targetMinutes: number,
): { shares: Record<SportFamily, number>; runCapped: boolean } {
  // Without history there is nothing to grow from; the no-history target is the athlete's own.
  if (targetMinutes <= 0 || shares.running <= 0 || !history.length) {
    return { shares, runCapped: false };
  }
  const runMinutes = history
    .filter((day) => day.family === "running")
    .reduce((sum, day) => sum + day.minutes, 0);
  const cap = Math.max(45, (runMinutes / HISTORY_WEEKS) * RUN_GROWTH);
  const wanted = targetMinutes * shares.running;
  if (wanted <= cap) return { shares, runCapped: false };
  const running = cap / targetMinutes;
  const excess = shares.running - running;
  const toRide = shares.cycling >= 0.05;
  return {
    shares: {
      running,
      cycling: shares.cycling + (toRide ? excess : 0),
      other: shares.other + (toRide ? 0 : excess),
    },
    runCapped: true,
  };
}

function splitRemaining(
  target: number,
  remaining: number,
  shares: Record<SportFamily, number>,
  done: Record<SportFamily, number>,
) {
  const families: SportFamily[] = ["cycling", "running", "other"];
  const gaps = families.map((family) => Math.max(0, target * shares[family] - done[family]));
  const gapSum = gaps.reduce((sum, gap) => sum + gap, 0);
  const left = {} as Record<SportFamily, number>;
  families.forEach((family, index) => {
    const share = gapSum > 0 ? gaps[index] / gapSum : shares[family];
    left[family] = round5(remaining * share);
  });
  return left;
}

/** A target zone, or Z1 for warm-ups, recoveries, and easy between reps. */
export type StepZone = "z1" | TargetZone;

const ZONE_INDEX: Record<StepZone, number> = { z1: 0, z2: 1, z3: 2, z4: 3, z5: 4 };

/** Minutes an activity spent at or above the session's zone. */
function minutesAtZone(activity: WeekActivity, zone: TargetZone) {
  const index = ZONE_INDEX[zone];
  if (activity.zoneMinutes) {
    return activity.zoneMinutes.slice(index).reduce((sum, minutes) => sum + minutes, 0);
  }
  // No stream: zone 3 and up comes from the load estimate; zone 2 is the whole activity.
  return index >= 2 ? activity.hardMinutes : activity.minutes;
}

function keySessionDoneBy(
  session: KeySession,
  activity: WeekActivity,
  ownSport: KeySport | null = null,
) {
  // Any ride, run, swim, or walk can tick off intervals: the stimulus counts, not the sport. Other
  // sport types never do (ADR 0029).
  if (isOtherSportType(activity.sportType)) return false;
  // A goal's long session trains the goal's sport: a long ride is not a long run (ADR 0024).
  if (ownSport && sportGroupFor(activity.sportType)?.id !== ownSport) return false;
  const needed = keySessionWorkMinutes(session) * KEY_SESSION_DONE_SHARE;
  if (session.kind === "long") return activity.minutes >= needed;
  return minutesAtZone(activity, session.zone) >= needed;
}

/** Hard minutes in one activity that make it a hard day. */
export const HARD_DAY_MINUTES = 15;

/** An activity this long counts as one of the week's easy sessions. */
export const EASY_SESSION_MIN_MINUTES = 20;

/** Key session types per rotation, picked by the season phase. The first always comes; the others rotate week to week. */
const KEY_ROTATION: Record<BuildPace, KeySessionPresetId[]> = {
  hold: ["long", "tempo"],
  slow: ["tempo", "long", "threshold"],
  steady: ["threshold", "long", "tempo"],
  fast: ["vo2", "threshold", "long"],
  overreach: ["vo2", "threshold", "long", "tempo"],
};

/** Reps × work minutes by fitness level (low, mid, high). */
const KEY_SIZES: Record<Exclude<KeySessionPresetId, "long">, [number, number][]> = {
  vo2: [
    [4, 3],
    [5, 4],
    [6, 4],
  ],
  threshold: [
    [3, 8],
    [3, 10],
    [4, 10],
  ],
  tempo: [
    [2, 15],
    [2, 20],
    [3, 20],
  ],
};

/** Key session types a phase leads with. */
export function keySessionTypes(rotation: BuildPace) {
  return KEY_ROTATION[rotation].map(
    (preset) => KEY_SESSION_PRESETS.find((item) => item.id === preset)?.label ?? preset,
  );
}

function weekNumber(weekStart: string) {
  return Math.floor(Date.parse(`${weekStart}T12:00:00Z`) / (7 * 86_400_000));
}

/** A long session is never shortened below this to fit the week. */
const LONG_MIN_MINUTES = 45;

/**
 * This week's key sessions, built from their count, the season phase, fitness, and target.
 * Toward a goal the long session leads in base and comes second from build on (ADR 0024).
 */
export function generateKeySessions(input: {
  count: number;
  season: Pick<SeasonPhase, "rotation"> & {
    kind?: SeasonPhase["kind"];
    sessions?: Pick<GoalSessions, "longMinutes"> | null;
  };
  weekStart: string;
  ctl: number;
  targetMinutes: number;
}): KeySession[] {
  const { count } = input;
  if (count <= 0) return [];
  const [first, ...rest] = KEY_ROTATION[input.season.rotation];
  const shift = rest.length ? weekNumber(input.weekStart) % rest.length : 0;
  const rotated = [...rest.slice(shift), ...rest.slice(0, shift)];
  let order: KeySessionPresetId[] = [first, ...rotated];
  // The week has a long session day (ADR 0026): the long session leads in base and comes
  // second otherwise, so any week with two key sessions has one.
  const others = order.filter((preset) => preset !== "long");
  order =
    input.season.kind === "base" || others.length === 0
      ? ["long", ...others]
      : [others[0]!, "long", ...others.slice(1)];
  const level = input.ctl < 35 ? 0 : input.ctl < 65 ? 1 : 2;
  // Toward a goal the long session grows with it; otherwise it is a quarter of the week.
  const longMinutes =
    input.season.sessions?.longMinutes ??
    clamp(Math.round((input.targetMinutes * 0.25) / 15) * 15, 75, 240);

  const sessions: KeySession[] = [];
  for (let index = 0; index < count; index += 1) {
    const preset = order[index % order.length];
    const session = keySessionFromPreset(preset, `${input.weekStart}-${index + 1}-${preset}`);
    if (preset === "long") session.workMinutes = longMinutes;
    else [session.reps, session.workMinutes] = KEY_SIZES[preset][level];
    sessions.push(session);
  }

  // Key sessions never take more than 60% of the week: intervals go first, last one first;
  // the long session is shortened rather than dropped.
  const budget = input.targetMinutes * 0.6;
  const total = () => sessions.reduce((sum, session) => sum + keySessionMinutes(session), 0);
  while (sessions.length > 1 && total() > budget) {
    let lastIntervals = -1;
    sessions.forEach((session, index) => {
      if (session.kind !== "long") lastIntervals = index;
    });
    if (lastIntervals < 0) break;
    sessions.splice(lastIntervals, 1);
  }
  const long = sessions.find((session) => session.kind === "long");
  if (long && total() > budget) {
    const room = budget - (total() - keySessionMinutes(long));
    long.workMinutes = Math.max(LONG_MIN_MINUTES, Math.floor(room / 15) * 15);
  }
  return sessions;
}

export type PlannedKeySession = KeySession & {
  sport: KeySport;
  suggestedSport: KeySport;
  sportPinned: boolean;
};

/** Time on rides and runs below this share leaves no room to move key sessions onto them. */
const RIDE_RUN_MIN_SHARE = 0.15;

/**
 * A sport for each key session. Toward a goal, the main one and the long one go on the goal's
 * sport; otherwise on the sport the athlete does most, with a long Z2 on the bike when they ride.
 * The rest spread by the ride / run balance. Their own pick wins.
 */
export function assignKeySports(
  sessions: KeySession[],
  shares: Record<SportFamily, number>,
  pinned: Record<string, KeySport>,
  goal: Pick<GoalSessions, "keySport"> | null = null,
  sports: readonly KeySport[] = ["cycling", "running"],
): PlannedKeySession[] {
  const both = shares.cycling + shares.running;
  const runShare = both > 0 ? shares.running / both : 0.5;
  const rides = runShare <= 0.9 && sports.includes("cycling");
  const runs = runShare >= 0.1 && sports.includes("running");
  // Without rides or runs to plan, the athlete's other sport leads.
  const historyLead: KeySport =
    runShare > 0.5 && runs ? "running" : rides ? "cycling" : runs ? "running" : sports[0]!;
  const dominant: KeySport = goal?.keySport ?? historyLead;
  const rideOrRunLead = dominant === "cycling" || dominant === "running";
  const other: KeySport = !rideOrRunLead
    ? historyLead
    : dominant === "cycling"
      ? "running"
      : "cycling";
  const longSport: KeySport =
    goal?.keySport ?? (rides ? "cycling" : runs ? "running" : historyLead);
  const intervals = sessions.filter((session) => session.kind !== "long").length;
  // How many interval sessions go on the other sport, rounded to whole sessions. A swim or walk
  // goal keeps the main one and gives the rest to rides or runs when the athlete does them.
  let otherQuota = rideOrRunLead
    ? rides && runs && sports.includes(other)
      ? Math.round(intervals * Math.min(runShare, 1 - runShare))
      : 0
    : both >= RIDE_RUN_MIN_SHARE
      ? intervals - 1
      : 0;
  let placedDominant = false;
  return sessions.map((session) => {
    let suggested: KeySport;
    if (session.kind === "long") suggested = longSport;
    else if (!placedDominant || otherQuota <= 0) {
      suggested = dominant;
      placedDominant = true;
    } else {
      suggested = other;
      otherQuota -= 1;
    }
    const own = pinned[session.id];
    return {
      ...session,
      sport: own ?? suggested,
      suggestedSport: suggested,
      sportPinned: own != null,
    };
  });
}

/** Each activity ticks off at most one key session; the hardest sessions are matched first. */
export function matchKeySessions(
  sessions: PlannedKeySession[],
  activities: WeekActivity[],
  goalSport: KeySport | null = null,
): KeySessionStatus[] {
  const order = sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      const longLast = Number(left.session.kind === "long") - Number(right.session.kind === "long");
      if (longLast !== 0) return longLast;
      return ZONE_INDEX[right.session.zone] - ZONE_INDEX[left.session.zone];
    });
  const used = new Set<string>();
  const done = new Map<number, WeekActivity>();
  for (const { session, index } of order) {
    const match = activities.find(
      (activity) =>
        !used.has(activity.id) &&
        keySessionDoneBy(
          session,
          activity,
          session.kind === "long" && session.sport === goalSport ? goalSport : null,
        ),
    );
    if (!match) continue;
    used.add(match.id);
    done.set(index, match);
  }
  return sessions.map((session, index) => ({
    session,
    minutes: keySessionMinutes(session),
    done: done.get(index) ?? null,
    suggestedSport: session.suggestedSport,
    sportPinned: session.sportPinned,
  }));
}

/** Moves the time of sports the athlete does not plan onto the ones they do. */
export function planShares(
  shares: Record<SportFamily, number>,
  sports: readonly KeySport[],
): Record<SportFamily, number> {
  const allowed: Record<SportFamily, boolean> = {
    cycling: sports.includes("cycling"),
    running: sports.includes("running"),
    other: sports.includes("swimming") || sports.includes("walking"),
  };
  const families: SportFamily[] = ["cycling", "running", "other"];
  const kept = families.filter((family) => allowed[family]);
  if (!kept.length) return shares;
  const keptTotal = kept.reduce((sum, family) => sum + shares[family], 0);
  const next = { cycling: 0, running: 0, other: 0 };
  for (const family of kept) {
    next[family] = keptTotal > 0 ? shares[family] / keptTotal : 1 / kept.length;
  }
  return next;
}

/**
 * `recentWeekLoads` stands in for the loads of the weeks before when they are projected rather
 * than copied from Strava, as for a week ahead.
 */
export function summarizeWeek(
  data: WeekTargetData & { plan: TrainingPlan },
  recentWeekLoads?: number[],
): WeekSummary {
  const { plan, activities, weekStart } = data;
  const loadPerHour = recentLoadPerHour(data.history);
  const target = weeklyTarget({
    plan,
    season: data.season,
    weekStartFitness: data.weekStartFitness,
    loadPerHour,
    weekStart,
    recentAverageLoad: rampBaseLoad(recentWeekLoads ?? weekLoadsBefore(data.history, weekStart)),
  });
  const form = data.fitness.ctl - data.fitness.atl;
  const trainingDays = trainingDayCount(plan);

  const done: Record<SportFamily, number> = { running: 0, cycling: 0, other: 0 };
  let doneLoad = 0;
  for (const activity of activities) {
    done[activity.family] += activity.minutes;
    doneLoad += activity.load;
  }
  const doneMinutes = done.running + done.cycling + done.other;
  const remainingMinutes = Math.max(0, target.minutes - doneMinutes);
  const remainingLoad = Math.max(0, target.load - doneLoad);

  const capped = capRunShare(
    blendShares(sportShares(data.history), data.season),
    data.history,
    target.minutes,
  );
  const shares = planShares(capped.shares, plan.sports);
  const left = splitRemaining(target.minutes, remainingMinutes, shares, done);

  const generated = generateKeySessions({
    count: keySessionCountFor({
      objective: data.season.anchor.length ? data.season.objective : null,
      phaseMax: data.season.maxKeySessions,
      trainingDays,
    }),
    season: data.season,
    weekStart,
    ctl: data.weekStartFitness.ctl,
    targetMinutes: target.minutes,
  });
  const planned = assignKeySports(
    generated,
    shares,
    plan.keySessionSports,
    data.season.sessions,
    plan.sports,
  );
  const goalSport = data.season.sessions?.keySport ?? null;
  const keySessions = matchKeySessions(planned, activities, goalSport);

  return {
    target,
    doneMinutes,
    doneLoad: Math.round(doneLoad),
    remainingMinutes,
    remainingLoad: Math.round(remainingLoad),
    shares,
    runCapped: capped.runCapped,
    bySport: {
      running: { done: done.running, left: left.running },
      cycling: { done: done.cycling, left: left.cycling },
      other: { done: done.other, left: left.other },
    },
    keySessions,
    paused: form < PAUSE_FORM,
    loadPerHour,
    form,
    trainingDays,
  };
}

const EASY_INTENSITY = 0.65;
const RECOVERY_INTENSITY = 0.55;
const BETWEEN_INTENSITY = 0.6;
const ZONE_INTENSITY: Record<TargetZone, number> = { z2: 0.7, z3: 0.82, z4: 0.92, z5: 1 };

/** Coggan power bands as a share of FTP. */
const POWER_BANDS: Record<StepZone, [number, number]> = {
  z1: [0, 0.55],
  z2: [0.56, 0.75],
  z3: [0.76, 0.9],
  z4: [0.91, 1.05],
  z5: [1.06, 1.2],
};

const ZONE_RPE: Record<StepZone, string> = {
  z1: "RPE 1–2, very easy",
  z2: "RPE 3–4, conversational",
  z3: "RPE 5–6, short phrases",
  z4: "RPE 7–8, hard but even",
  z5: "RPE 9, still controlled",
};

const KEY_SPORT_TYPE: Record<KeySport, string> = {
  cycling: "Ride",
  running: "Run",
  swimming: "Swim",
  walking: "Walk",
};

/** Heart-rate bounds of a zone, cut by the same sport model as the heart rate page. */
function zoneBpm(zone: StepZone, family: KeySport, anchors: PlanningAnchors) {
  const sportAnchors = anchors.heartRate[family];
  if (!sportAnchors.maxHr && !sportAnchors.lthr) return null;
  const zones = zonesFromHistogram(emptyHistogram(), KEY_SPORT_TYPE[family], sportAnchors);
  const stat = zones[ZONE_INDEX[zone]];
  if (!stat || stat.minBpm == null || stat.maxBpm == null) return null;
  return { min: stat.minBpm, max: stat.maxBpm, top: zone === "z5" };
}

/** How to hold a zone: watts on bikes with a meter, heart rate with a belt or watch, else RPE. */
export function zoneCue(
  zone: StepZone,
  family: KeySport,
  collectors: FamilyCollectors,
  anchors: PlanningAnchors,
) {
  if (family === "cycling" && collectors.power && anchors.ftpWatts) {
    const [low, high] = POWER_BANDS[zone];
    if (zone === "z1") return `under ${Math.round(anchors.ftpWatts * high)} W`;
    return `${Math.round(anchors.ftpWatts * low)}–${Math.round(anchors.ftpWatts * high)} W`;
  }
  if (collectors.heartRate) {
    const bpm = zoneBpm(zone, family, anchors);
    if (bpm && zone === "z1") return `under ${bpm.max} bpm`;
    if (bpm) return bpm.top ? `${bpm.min}+ bpm` : `${bpm.min}–${bpm.max} bpm`;
  }
  return ZONE_RPE[zone];
}

/** Upper edge of zone 2, when the athlete has a usable anchor for that sport. */
function easyCap(family: KeySport, collectors: FamilyCollectors, anchors: PlanningAnchors) {
  if (family === "cycling" && collectors.power && anchors.ftpWatts) {
    return `Hold under ${Math.round(anchors.ftpWatts * POWER_BANDS.z2[1])} W.`;
  }
  const bpm = collectors.heartRate ? zoneBpm("z2", family, anchors) : null;
  if (bpm) return `Keep heart rate under ${bpm.max} bpm.`;
  return "You should be able to talk in full sentences.";
}

function keySessionIntensity(session: KeySession) {
  const total = keySessionMinutes(session);
  const work = keySessionWorkMinutes(session);
  const other = Math.max(0, total - work);
  const zone = ZONE_INTENSITY[session.zone];
  return Math.sqrt((work * zone * zone + other * BETWEEN_INTENSITY ** 2) / Math.max(1, total));
}

export function keySessionDescription(
  session: KeySession,
  family: KeySport,
  data: Pick<WeekTargetData, "collectors" | "anchors"> & {
    season?: Pick<SeasonPhase, "sessions">;
  },
) {
  const cue = zoneCue(session.zone, family, data.collectors[family], data.anchors);
  const zone = zoneLabel(session.zone);
  const goal = data.season?.sessions;
  const onGoalSport = goal?.keySport === family;
  if (session.kind === "long") {
    const climb =
      onGoalSport && goal.longClimbM ? ` Take in about ${goal.longClimbM} m of climbing.` : "";
    return `${formatHours(session.workMinutes / 60)} in ${zone} (${cue}).${climb} Eat and drink from the first hour.`;
  }
  const hill = onGoalSport && goal.hilly ? " on a climb" : "";
  const work =
    session.reps === 1
      ? `${session.workMinutes} min`
      : `${session.reps} × ${session.workMinutes} min`;
  const between =
    session.reps > 1 && session.restMinutes > 0 ? `, ${session.restMinutes} min easy between` : "";
  return `${WARM_UP_LABEL}. ${work} in ${zone}${hill} (${cue})${between}. ${COOL_DOWN_LABEL}.`;
}

const WARM_UP_LABEL = "15 min easy";
const COOL_DOWN_LABEL = "10 min easy";

function sessionTitle(
  kind: SessionKind,
  sport: PartSport,
  minutes: number,
  keySession: KeySession | null,
) {
  const noun = PART_NOUN[sport];
  if (kind === "key" && keySession) return keySessionName(keySession);
  if (kind === "rest") return "Rest day";
  if (kind === "recovery") return `Recovery ${noun}`;
  return minutes >= 120 ? `Long easy ${noun}` : `Easy ${noun}`;
}

/** Intervals or time at zone 3 and above: never on the day after another hard day. */
export function isHardKeySession(session: KeySession) {
  return session.kind !== "long" && ZONE_INDEX[session.zone] >= 2;
}

/** Sports a planned session can be on: those with heart-rate zones. */
export type PartSport = KeySport;

/** One part of a day, in order. The main part carries the session kind. */
export type DayPart = { sport: PartSport; minutes: number; main: boolean };

const PART_NOUN: Record<PartSport, string> = {
  cycling: "ride",
  running: "run",
  swimming: "swim",
  walking: "walk",
};

export function partNoun(sport: PartSport) {
  return PART_NOUN[sport];
}

/** How to hold an easy part in a sport without zones or watts in VO2. */
function partHint(sport: PartSport, data: Pick<WeekTargetData, "collectors" | "anchors">) {
  if (sport === "swimming" || sport === "walking") {
    const feel =
      sport === "swimming"
        ? "Long, relaxed strokes; you could keep going."
        : "Brisk, breathing through your nose.";
    const bpm = data.collectors[sport].heartRate ? zoneBpm("z2", sport, data.anchors) : null;
    return bpm ? `${feel} Keep heart rate under ${bpm.max} bpm.` : feel;
  }
  return easyCap(sport, data.collectors[sport], data.anchors);
}

function partCue(
  sport: PartSport,
  zone: StepZone,
  data: Pick<WeekTargetData, "collectors" | "anchors">,
) {
  return zoneCue(zone, sport, data.collectors[sport], data.anchors);
}

/** Fewer reps (or a shorter long Z2) so a key session fits the window the athlete has. */
export function fitKeySession(session: KeySession, available: number): KeySession {
  if (keySessionMinutes(session) <= available + 10) return session;
  if (session.kind === "long") {
    return { ...session, workMinutes: Math.max(30, round5(available)) };
  }
  const room = available - WARM_UP_MINUTES - COOL_DOWN_MINUTES + session.restMinutes;
  const reps = clamp(
    Math.floor(room / (session.workMinutes + session.restMinutes)),
    1,
    session.reps,
  );
  return { ...session, reps };
}

/** Copied activities dated today, in the order they were done. */
export function todayActivities(data: Pick<WeekTargetData, "today" | "activities">) {
  return data.activities.filter((activity) => activity.date === data.today);
}

/** Today is done once any copied activity is dated today. Another session is extra. */
export function isTodayComplete(data: Pick<WeekTargetData, "today" | "activities">) {
  return todayActivities(data).length > 0;
}

/** Goals of this week on `date`, from the anchor, B goals, and C goals the phase knows about. */
export function goalsOn(data: Pick<WeekTargetData, "season">, date: string) {
  const { anchor, tuneUp, trainThrough } = data.season;
  const seen = new Set<string>();
  return [...anchor, ...tuneUp, ...trainThrough].filter((goal) => {
    if (goal.date !== date || seen.has(goal.id)) return false;
    seen.add(goal.id);
    return true;
  });
}

/** Three short efforts the day before a race: they wake the legs without tiring them. */
export const OPENER: KeySession = {
  id: "opener",
  kind: "intervals",
  sport: "any",
  reps: 3,
  workMinutes: 1,
  zone: "z5",
  restMinutes: 2,
};

/** Load, effect on the week, and wording for a chosen day. */
export function buildRecommendation(
  pick: {
    kind: SessionKind;
    keySession: KeySession | null;
    parts: DayPart[];
    reasons: string[];
    warnings?: string[];
  },
  data: WeekTargetData,
  summary: WeekSummary,
): Recommendation {
  const { kind, keySession, parts, reasons } = pick;
  if (kind === "race") {
    return {
      kind,
      keySession: null,
      family: "cycling",
      minutes: 0,
      parts: [],
      title: "Race day",
      description: reasons[0] ?? "Race day.",
      reasons: [],
      warnings: [],
      load: 0,
      after: {
        remainingMinutes: summary.remainingMinutes,
        formTomorrow: data.fitness.ctl - data.fitness.atl,
        formTomorrowLabel: formLabel(data.fitness.ctl - data.fitness.atl),
        fitnessChange: 0,
      },
    };
  }
  const main = parts.find((part) => part.main) ?? parts[0];
  const family: PartSport = main?.sport ?? "cycling";
  const minutes = kind === "rest" ? 0 : (main?.minutes ?? 0);
  const mainIntensity =
    kind === "key" && keySession
      ? keySessionIntensity(keySession)
      : kind === "recovery"
        ? RECOVERY_INTENSITY
        : EASY_INTENSITY;
  // Scale a generic session by how costly an hour usually is for this athlete.
  const perHour = summary.loadPerHour / stress(60, EASY_INTENSITY);
  const totalMinutes = kind === "rest" ? 0 : parts.reduce((sum, part) => sum + part.minutes, 0);
  const partStress = (part: DayPart) => {
    if (!part.main) return stress(part.minutes, EASY_INTENSITY);
    if (kind !== "key" || !keySession) return stress(part.minutes, mainIntensity);
    // Time beyond the key session in its part (a hand-set split) is steady Z2.
    const keyMinutes = Math.min(part.minutes, keySessionMinutes(keySession));
    return stress(keyMinutes, mainIntensity) + stress(part.minutes - keyMinutes, EASY_INTENSITY);
  };
  const load = Math.round(
    (kind === "rest" ? 0 : parts.reduce((sum, part) => sum + partStress(part), 0)) * perHour,
  );
  const ctl = data.fitness.ctl + load / CTL_DAYS;
  const atl = data.fitness.atl + load / ATL_DAYS;
  const formTomorrow = ctl - atl;

  const describe = (part: DayPart) => {
    const noun = PART_NOUN[part.sport];
    if (!part.main)
      return `${formatHours(part.minutes / 60)} easy ${noun}: ${partHint(part.sport, data)}`;
    if (kind === "rest") {
      return summary.remainingMinutes > 0
        ? "Take the day off."
        : "Take the day off. The week’s target is already met.";
    }
    if (kind === "recovery") return `Zone 1 only, no surges. ${partHint(part.sport, data)}`;
    if (keySession) {
      const extra = round5(part.minutes - keySessionMinutes(keySession));
      const steady =
        extra >= 5 ? ` Add ${formatHours(extra / 60)} steady Z2 before the cool-down.` : "";
      return `${keySessionDescription(keySession, part.sport, data)}${steady}`;
    }
    return `Zone 2 the whole way. ${partHint(part.sport, data)}`;
  };
  const description =
    kind === "rest"
      ? describe({ sport: family, minutes: 0, main: true })
      : parts
          .map((part, index) => (index === 0 ? describe(part) : `Then ${describe(part)}`))
          .join(" ");
  const titles = parts.map((part, index) =>
    part.main
      ? sessionTitle(kind, part.sport, part.minutes, keySession)
      : `${index === 0 ? "Easy" : "easy"} ${PART_NOUN[part.sport]}`,
  );

  return {
    kind,
    keySession,
    family,
    minutes,
    parts,
    title: kind === "rest" ? "Rest day" : titles.join(" + "),
    description,
    reasons,
    warnings: pick.warnings ?? [],
    load,
    after: {
      remainingMinutes: Math.max(0, summary.remainingMinutes - totalMinutes),
      formTomorrow,
      formTomorrowLabel: formLabel(formTomorrow),
      fitnessChange: load / CTL_DAYS,
    },
  };
}

export type SessionStep = {
  label: string;
  minutes: number;
  zone: StepZone;
  cue: string;
  sport: PartSport;
  /** Set on the hard part of a key session. */
  work: boolean;
};

/** Minute-by-minute shape of today, part by part, for the profile chart and the steps table. */
export function sessionSteps(
  pick: Pick<Recommendation, "kind" | "keySession" | "parts">,
  data: Pick<WeekTargetData, "collectors" | "anchors">,
): SessionStep[] {
  const steps: SessionStep[] = [];
  if (pick.kind === "rest") return steps;
  const multi = pick.parts.length > 1;
  for (const part of pick.parts) {
    if (part.minutes <= 0) continue;
    const step = (label: string, minutes: number, zone: StepZone, work = false) => {
      steps.push({
        label: multi ? `${capitalize(PART_NOUN[part.sport])} · ${label}` : label,
        minutes,
        zone,
        cue: partCue(part.sport, zone, data),
        sport: part.sport,
        work,
      });
    };
    const session = part.main ? pick.keySession : null;
    if (!part.main) step("Easy", part.minutes, "z2");
    else if (pick.kind === "recovery") step("Recovery", part.minutes, "z1");
    else if (!session || pick.kind !== "key" || session.kind === "long") {
      if (part.minutes < 40) step("Steady", part.minutes, "z2", Boolean(session));
      else {
        step("Ease in", 10, "z1");
        step("Steady", part.minutes - 20, "z2", Boolean(session));
        step("Ease out", 10, "z1");
      }
    } else {
      step("Warm-up", WARM_UP_MINUTES, "z1");
      for (let rep = 1; rep <= session.reps; rep += 1) {
        const label = session.reps === 1 ? "Main block" : `Rep ${rep} of ${session.reps}`;
        step(label, session.workMinutes, session.zone, true);
        if (rep < session.reps && session.restMinutes > 0) step("Easy", session.restMinutes, "z1");
      }
      // A hand-set split can give the key part more time than the session: ride it steady.
      const extra = round5(part.minutes - keySessionMinutes(session));
      if (extra >= 5) step("Steady", extra, "z2");
      step("Cool-down", COOL_DOWN_MINUTES, "z1");
    }
  }
  return steps;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function minutesByZone(steps: SessionStep[]) {
  const totals: Record<StepZone, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const step of steps) totals[step.zone] += step.minutes;
  return totals;
}

export const loadWeekTarget = createServerFn({ method: "GET" }).handler(
  async (): Promise<WeekTargetData & { ahead: WeekAhead[] }> => {
    const { loadWeekTargetImpl } = await import("./week-target.server.ts");
    return loadWeekTargetImpl();
  },
);
