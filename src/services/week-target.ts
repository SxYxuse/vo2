import { createServerFn } from "@tanstack/react-start";

import { emptyHistogram, zonesFromHistogram } from "./heart-rate.ts";
import { ATL_DAYS, CTL_DAYS, formLabel } from "./training-load.ts";
import {
  BUILD_PACES,
  DEFAULT_LOAD_PER_HOUR,
  KEY_SESSION_PRESETS,
  COOL_DOWN_MINUTES,
  WARM_UP_MINUTES,
  addDayKey,
  formatHours,
  easySessionRange,
  keySessionCount,
  keySessionFromPreset,
  keySessionMinutes,
  keySessionName,
  keySessionWorkMinutes,
  zoneLabel,
  type BuildPace,
  type FamilyCollectors,
  type KeySession,
  type KeySessionPresetId,
  type PlanningAnchors,
  type SportFamily,
  type TargetZone,
  type TrainingPlan,
} from "./training-plan.types.ts";

/** Complete weeks before this one used for the usual pace, sport split, and ramp check. */
export const HISTORY_WEEKS = 8;
/** A finished week above this many times the last-4-week load is flagged. */
export const RAMP_WARNING_RATIO = 1.3;

export const AVAILABLE_WINDOWS = [
  { minutes: 30, label: "30 min" },
  { minutes: 45, label: "45 min" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1h 30" },
  { minutes: 120, label: "2h" },
  { minutes: 180, label: "3h" },
] as const;

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
  collectors: { running: FamilyCollectors; cycling: FamilyCollectors };
  anchors: PlanningAnchors;
};

export type WeekTarget = {
  minutes: number;
  load: number;
  source: "auto" | "manual" | "no-history";
};

export type PaceStatus = "done" | "ahead" | "on-track" | "behind";

export type WeekSummary = {
  target: WeekTarget;
  doneMinutes: number;
  doneLoad: number;
  remainingMinutes: number;
  remainingLoad: number;
  daysLeft: number;
  trainingDaysLeft: number;
  restDayAhead: boolean;
  perDayMinutes: number;
  pace: { expectedMinutes: number; status: PaceStatus; fromHistory: boolean };
  shares: Record<SportFamily, number>;
  bySport: Record<SportFamily, { done: number; left: number }>;
  keySessions: KeySessionStatus[];
  /** Planned minutes of key sessions still to do (0 while paused). */
  keyLeftMinutes: number;
  /** Key sessions are paused when form is very low. */
  paused: boolean;
  easy: {
    target: number;
    left: number;
    /** The easy-session range from the week mix, how many are planned now, and how many are done. */
    min: number;
    max: number;
    planned: number;
    done: number;
    /** Suggested length of each easy session still to do. */
    perSession: number;
    /** Days left that can take one more session without doubling up. */
    singleDaySlots: number;
  };
  /** Days with two or more sessions: allowed by the week mix, used, and left. */
  doubles: { allowed: number; used: number; left: number };
  loadPerHour: number;
  form: number;
};

export type KeySessionStatus = {
  session: KeySession;
  minutes: number;
  done: WeekActivity | null;
  /** Dropped for this week: more open key sessions than training days left. */
  skipped: boolean;
};

export type SessionKind = "rest" | "recovery" | "easy" | "key";

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
  weekLoad: number;
  recentAverageLoad: number | null;
  rampRatio: number | null;
  warn: boolean;
};

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function round5(minutes: number) {
  return Math.max(0, Math.round(minutes / 5) * 5);
}

function weekdayOf(key: string) {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function stress(minutes: number, intensity: number) {
  return (minutes / 60) * 100 * intensity * intensity;
}

export function rampFor(buildPace: BuildPace, form: number) {
  let pace = buildPace;
  if (form < -30) pace = "hold";
  else if (form < -10 && pace === "overreach") pace = "fast";
  else if (form < -18 && (pace === "fast" || pace === "overreach")) pace = "steady";
  return BUILD_PACES.find((item) => item.id === pace)?.ramp ?? 0;
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

export function weeklyTarget(input: {
  plan: TrainingPlan;
  weekStartFitness: FitnessPoint;
  loadPerHour: number;
}): WeekTarget {
  const { plan, loadPerHour } = input;
  const { ctl, atl } = input.weekStartFitness;
  if (plan.targetMode === "manual" || ctl <= 5) {
    const minutes = Math.round(plan.targetWeeklyHours * 60);
    return {
      minutes,
      load: Math.round((minutes / 60) * loadPerHour),
      source: plan.targetMode === "manual" ? "manual" : "no-history",
    };
  }
  const load = Math.max(0, 7 * ctl + CTL_DAYS * rampFor(plan.buildPace, ctl - atl));
  const hours = clamp(Math.round((load / loadPerHour) * 4) / 4, 0.5, 30);
  return { minutes: Math.round(hours * 60), load: Math.round(load), source: "auto" };
}

function weekMinutesByDay(history: DayTotal[], weekStart: string) {
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const day of history) {
    const index = daysBetween(weekStart, day.date);
    if (index >= 0 && index < 7) days[index] += day.minutes;
  }
  return days;
}

/** Average share of the week done by the end of each weekday, Monday first. */
export function usualWeekCurve(history: DayTotal[], weekStart: string): number[] | null {
  const curves: number[][] = [];
  for (let week = 1; week <= HISTORY_WEEKS; week += 1) {
    const days = weekMinutesByDay(history, addDayKey(weekStart, -7 * week));
    const total = days.reduce((sum, minutes) => sum + minutes, 0);
    if (total < 60) continue;
    let running = 0;
    curves.push(
      days.map((minutes) => {
        running += minutes;
        return running / total;
      }),
    );
  }
  if (curves.length < 3) return null;
  return Array.from(
    { length: 7 },
    (_, index) => curves.reduce((sum, curve) => sum + curve[index], 0) / curves.length,
  );
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

function sportFits(session: KeySession, activity: WeekActivity) {
  if (activity.family === "other") return false;
  return session.sport === "any" || session.sport === activity.family;
}

/** Minutes an activity spent at or above the session's zone. */
function minutesAtZone(activity: WeekActivity, zone: TargetZone) {
  const index = ZONE_INDEX[zone];
  if (activity.zoneMinutes) {
    return activity.zoneMinutes.slice(index).reduce((sum, minutes) => sum + minutes, 0);
  }
  // No stream: zone 3 and up comes from the load estimate; zone 2 is the whole activity.
  return index >= 2 ? activity.hardMinutes : activity.minutes;
}

function keySessionDoneBy(session: KeySession, activity: WeekActivity) {
  if (!sportFits(session, activity)) return false;
  const needed = keySessionWorkMinutes(session) * KEY_SESSION_DONE_SHARE;
  if (session.kind === "long") return activity.minutes >= needed;
  return minutesAtZone(activity, session.zone) >= needed;
}

/** Hard minutes in one activity that make it a hard day. */
const HARD_DAY_MINUTES = 15;

/** An activity this long counts as one of the week's easy sessions. */
export const EASY_SESSION_MIN_MINUTES = 20;

/** Key session types per build pace. The first always comes; the others rotate week to week. */
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

/** Key session types a build pace leads with, for the settings preview. */
export function keySessionTypes(buildPace: BuildPace) {
  return KEY_ROTATION[buildPace].map(
    (preset) => KEY_SESSION_PRESETS.find((item) => item.id === preset)?.label ?? preset,
  );
}

function weekNumber(weekStart: string) {
  return Math.floor(Date.parse(`${weekStart}T12:00:00Z`) / (7 * 86_400_000));
}

/** This week's key sessions, built from the week mix, build pace, fitness, and target. */
export function generateKeySessions(input: {
  plan: Pick<TrainingPlan, "buildPace" | "weekMix">;
  weekStart: string;
  ctl: number;
  targetMinutes: number;
}): KeySession[] {
  const count = keySessionCount(input.plan.weekMix);
  if (count <= 0) return [];
  const [first, ...rest] = KEY_ROTATION[input.plan.buildPace];
  const shift = rest.length ? weekNumber(input.weekStart) % rest.length : 0;
  const rotated = [...rest.slice(shift), ...rest.slice(0, shift)];
  const order = [first, ...rotated];
  const level = input.ctl < 35 ? 0 : input.ctl < 65 ? 1 : 2;
  const longMinutes = clamp(Math.round((input.targetMinutes * 0.25) / 15) * 15, 75, 240);

  const sessions: KeySession[] = [];
  for (let index = 0; index < count; index += 1) {
    const preset = order[index % order.length];
    const session = keySessionFromPreset(preset, `${input.weekStart}-${index + 1}-${preset}`);
    if (preset === "long") session.workMinutes = longMinutes;
    else [session.reps, session.workMinutes] = KEY_SIZES[preset][level];
    sessions.push(session);
  }

  // Key sessions never take more than 60% of the week: drop the long one, then the last.
  const budget = input.targetMinutes * 0.6;
  const total = () => sessions.reduce((sum, session) => sum + keySessionMinutes(session), 0);
  while (sessions.length > 1 && total() > budget) {
    const long = sessions.findIndex((session) => session.kind === "long");
    sessions.splice(long >= 0 ? long : sessions.length - 1, 1);
  }
  return sessions;
}

/** Each activity ticks off at most one key session; the hardest sessions are matched first. */
export function matchKeySessions(
  sessions: KeySession[],
  activities: WeekActivity[],
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
      (activity) => !used.has(activity.id) && keySessionDoneBy(session, activity),
    );
    if (!match) continue;
    used.add(match.id);
    done.set(index, match);
  }
  return sessions.map((session, index) => ({
    session,
    minutes: keySessionMinutes(session),
    done: done.get(index) ?? null,
    skipped: false,
  }));
}

export function summarizeWeek(data: WeekTargetData & { plan: TrainingPlan }): WeekSummary {
  const { plan, activities, today, weekStart } = data;
  const loadPerHour = recentLoadPerHour(data.history);
  const target = weeklyTarget({
    plan,
    weekStartFitness: data.weekStartFitness,
    loadPerHour,
  });
  const form = data.fitness.ctl - data.fitness.atl;

  const done: Record<SportFamily, number> = { running: 0, cycling: 0, other: 0 };
  let doneLoad = 0;
  for (const activity of activities) {
    done[activity.family] += activity.minutes;
    doneLoad += activity.load;
  }
  const doneMinutes = done.running + done.cycling + done.other;
  const remainingMinutes = Math.max(0, target.minutes - doneMinutes);
  const remainingLoad = Math.max(0, target.load - doneLoad);

  const dayIndex = clamp(daysBetween(weekStart, today), 0, 6);
  const daysLeft = 7 - dayIndex;
  let restDayAhead = false;
  for (let offset = 0; offset < daysLeft; offset += 1) {
    if (weekdayOf(addDayKey(today, offset)) === plan.preferredRestWeekday) restDayAhead = true;
  }
  const trainingDaysLeft = restDayAhead && daysLeft > 1 ? daysLeft - 1 : daysLeft;

  const curve = usualWeekCurve(data.history, weekStart);
  const expectedShare = dayIndex === 0 ? 0 : curve ? curve[dayIndex - 1] : dayIndex / 7;
  const expectedMinutes = round5(target.minutes * expectedShare);
  const gap = doneMinutes - expectedMinutes;
  const status: PaceStatus =
    remainingMinutes <= 0 ? "done" : gap >= 30 ? "ahead" : gap >= -20 ? "on-track" : "behind";

  const shares = sportShares(data.history);
  const left = splitRemaining(target.minutes, remainingMinutes, shares, done);

  const generated = generateKeySessions({
    plan,
    weekStart,
    ctl: data.weekStartFitness.ctl,
    targetMinutes: target.minutes,
  });
  // Two key sessions on one day is rarely the athlete's intent: keep only as many open ones as
  // there are training days left (today counts unless it already had hard work), in priority order.
  const hardToday = activities.some(
    (activity) => activity.date === today && activity.hardMinutes >= HARD_DAY_MINUTES,
  );
  let keyDays = Math.max(0, trainingDaysLeft - (hardToday ? 1 : 0));
  const keySessions = matchKeySessions(generated, activities).map((status) => {
    if (status.done) return status;
    if (keyDays > 0) {
      keyDays -= 1;
      return status;
    }
    return { ...status, skipped: true };
  });
  const usedByKey = new Set(keySessions.map((status) => status.done?.id).filter(Boolean));
  const easyRange = easySessionRange(plan.weekMix);
  const easyDone = activities.filter(
    (activity) => !usedByKey.has(activity.id) && activity.minutes >= EASY_SESSION_MIN_MINUTES,
  ).length;
  const paused = form < PAUSE_FORM;
  const keyLeftMinutes = paused
    ? 0
    : keySessions
        .filter((status) => !status.done && !status.skipped)
        .reduce((sum, status) => sum + status.minutes, 0);
  // Within the range: aim high while there are days to spare, settle lower as they run out.
  const openKeys = paused
    ? 0
    : keySessions.filter((status) => !status.done && !status.skipped).length;
  // Any two sessions of 20 minutes or more on one date make a double day, whatever the sports.
  const sessionsByDate = new Map<string, number>();
  for (const activity of activities) {
    if (activity.minutes < EASY_SESSION_MIN_MINUTES) continue;
    sessionsByDate.set(activity.date, (sessionsByDate.get(activity.date) ?? 0) + 1);
  }
  const doublesUsed = [...sessionsByDate.values()].filter((count) => count >= 2).length;
  const doublesAllowed = plan.weekMix.doubleDays;
  const doublesLeft = Math.max(0, doublesAllowed - doublesUsed);
  const singleDaySlots = Math.max(0, trainingDaysLeft - openKeys);
  const easyDaysLeft = singleDaySlots + Math.min(doublesLeft, trainingDaysLeft);
  const easyPlanned = clamp(
    easyDone + easyDaysLeft,
    easyRange.min,
    Math.max(easyRange.max, easyDone),
  );
  const keyTotal = keySessions
    .filter((status) => !status.skipped)
    .reduce((sum, status) => sum + status.minutes, 0);

  return {
    target,
    doneMinutes,
    doneLoad: Math.round(doneLoad),
    remainingMinutes,
    remainingLoad: Math.round(remainingLoad),
    daysLeft,
    trainingDaysLeft,
    restDayAhead,
    perDayMinutes: round5(remainingMinutes / Math.max(1, trainingDaysLeft)),
    pace: { expectedMinutes, status, fromHistory: curve != null },
    shares,
    bySport: {
      running: { done: done.running, left: left.running },
      cycling: { done: done.cycling, left: left.cycling },
      other: { done: done.other, left: left.other },
    },
    keySessions,
    keyLeftMinutes,
    paused,
    easy: {
      target: Math.max(0, target.minutes - keyTotal),
      left: Math.max(0, remainingMinutes - keyLeftMinutes),
      min: easyRange.min,
      max: easyRange.max,
      planned: easyPlanned,
      done: easyDone,
      singleDaySlots,
      perSession: round5(
        Math.max(0, remainingMinutes - keyLeftMinutes) / Math.max(1, easyPlanned - easyDone),
      ),
    },
    doubles: { allowed: doublesAllowed, used: doublesUsed, left: doublesLeft },
    loadPerHour,
    form,
  };
}

/** Time picker default: the per-day share, snapped to the nearest window. */
export function defaultWindow(summary: WeekSummary) {
  const wanted = Math.max(45, summary.perDayMinutes);
  let best: number = AVAILABLE_WINDOWS[0].minutes;
  for (const window of AVAILABLE_WINDOWS) {
    if (Math.abs(window.minutes - wanted) < Math.abs(best - wanted)) best = window.minutes;
  }
  return best;
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

function familyLthr(family: "running" | "cycling", anchors: PlanningAnchors) {
  return family === "cycling" ? anchors.cyclingLthr : anchors.runLthr;
}

function familyMaxHr(family: "running" | "cycling", anchors: PlanningAnchors) {
  return family === "cycling" ? anchors.cyclingMaxHr : anchors.runMaxHr;
}

/** Heart-rate bounds of a zone, cut by the same sport model as the heart rate page. */
function zoneBpm(zone: StepZone, family: "running" | "cycling", anchors: PlanningAnchors) {
  const maxHr = familyMaxHr(family, anchors);
  const lthr = familyLthr(family, anchors);
  if (!maxHr && !lthr) return null;
  const zones = zonesFromHistogram(
    emptyHistogram(),
    family === "cycling" ? "Ride" : "Run",
    maxHr,
    lthr,
  );
  const stat = zones[ZONE_INDEX[zone]];
  if (!stat || stat.minBpm == null || stat.maxBpm == null) return null;
  return { min: stat.minBpm, max: stat.maxBpm, top: zone === "z5" };
}

/** How to hold a zone: watts on bikes with a meter, heart rate with a belt or watch, else RPE. */
export function zoneCue(
  zone: StepZone,
  family: "running" | "cycling",
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
function easyCap(
  family: "running" | "cycling",
  collectors: FamilyCollectors,
  anchors: PlanningAnchors,
) {
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
  family: "running" | "cycling",
  data: Pick<WeekTargetData, "collectors" | "anchors">,
) {
  const cue = zoneCue(session.zone, family, data.collectors[family], data.anchors);
  const zone = zoneLabel(session.zone);
  if (session.kind === "long") {
    return `${formatHours(session.workMinutes / 60)} in ${zone} (${cue}). Eat and drink from the first hour.`;
  }
  const work =
    session.reps === 1
      ? `${session.workMinutes} min`
      : `${session.reps} × ${session.workMinutes} min`;
  const between =
    session.reps > 1 && session.restMinutes > 0 ? `, ${session.restMinutes} min easy between` : "";
  return `${WARM_UP_LABEL}. ${work} in ${zone} (${cue})${between}. ${COOL_DOWN_LABEL}.`;
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
  if (sport === "strength")
    return kind === "recovery" ? "Light strength session" : "Strength session";
  if (kind === "key" && keySession) return keySessionName(keySession);
  if (kind === "rest") return "Rest day";
  if (kind === "recovery") return `Recovery ${noun}`;
  return minutes >= 120 ? `Long easy ${noun}` : `Easy ${noun}`;
}

function isHard(session: KeySession) {
  return session.kind !== "long" && ZONE_INDEX[session.zone] >= 2;
}

function hardRecently(activities: WeekActivity[], today: string) {
  const yesterday = addDayKey(today, -1);
  return activities.some(
    (activity) =>
      (activity.date === today || activity.date === yesterday) &&
      activity.hardMinutes >= HARD_DAY_MINUTES,
  );
}

export function pickFamily(
  summary: WeekSummary,
  available: number,
  sport: KeySession["sport"] = "any",
): "running" | "cycling" {
  if (sport !== "any") return sport;
  const rides = summary.shares.cycling >= 0.15;
  const { running, cycling } = summary.bySport;
  let family: "running" | "cycling" =
    running.left > cycling.left
      ? "running"
      : cycling.left > running.left
        ? "cycling"
        : summary.shares.running > summary.shares.cycling
          ? "running"
          : "cycling";
  if (family === "running" && available > 90 && rides) family = "cycling";
  if (family === "cycling" && !rides && summary.shares.running > 0) family = "running";
  return family;
}

/** One session for the time the athlete has today, and what it does to the week. */
/** Sports a part of today can be. "Either" lets VO2 pick between a ride and a run. */
export const DAY_SPORTS = [
  { id: "any", label: "Either" },
  { id: "cycling", label: "Ride" },
  { id: "running", label: "Run" },
  { id: "swimming", label: "Swim" },
  { id: "walking", label: "Walk" },
  { id: "strength", label: "Strength" },
] as const;

export const TODAY_FEELS = [
  { id: "auto", label: "Let VO2 pick" },
  { id: "easy", label: "Easy" },
  { id: "hard", label: "Hard" },
] as const;

export type DaySport = (typeof DAY_SPORTS)[number]["id"];
export type PartSport = Exclude<DaySport, "any">;
export type TodayFeel = (typeof TODAY_FEELS)[number]["id"];

/** A day has at most this many parts (for example swim, ride, then run). */
export const MAX_DAY_PARTS = 3;

/** What the athlete says about today: time, sports in order, and feel. VO2 adapts, it never refuses. */
export type TodayChoice = {
  available: number;
  sports: DaySport[];
  feel: TodayFeel;
  /** Minutes per sport, in order, when the athlete set the split themselves. */
  split?: number[] | null;
};

/** Smallest part a hand-set split can give a sport. */
export const SPLIT_MIN_MINUTES = 10;

/** The athlete's own split, when it still matches today's sports and time. */
export function customSplit(choice: TodayChoice): number[] | null {
  const { split, sports, available } = choice;
  if (!split || split.length !== sports.length || sports.length < 2) return null;
  if (split.some((minutes) => !Number.isFinite(minutes) || minutes < SPLIT_MIN_MINUTES))
    return null;
  const total = split.reduce((sum, minutes) => sum + minutes, 0);
  return Math.abs(total - available) <= 5 ? split : null;
}

export function isDefaultChoice(choice: TodayChoice) {
  return choice.feel === "auto" && choice.sports.length === 1 && choice.sports[0] === "any";
}

export function parseDaySports(value: unknown): DaySport[] {
  const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  const sports = raw
    .map((item) => DAY_SPORTS.find((sport) => sport.id === item)?.id)
    .filter((sport): sport is DaySport => Boolean(sport))
    .slice(0, MAX_DAY_PARTS);
  return sports.length ? sports : ["any"];
}

/** One part of today, in order. The main part carries today's session kind. */
export type DayPart = { sport: PartSport; minutes: number; main: boolean };

/** Any part after the main one takes at least this long, or it is left out. */
const PART_MIN_MINUTES = 20;

/** Share of an easy day each sport takes when combined: a ride runs longest, strength shortest. */
const PART_WEIGHT: Record<PartSport, number> = {
  cycling: 1.5,
  running: 1,
  swimming: 0.8,
  walking: 1,
  strength: 0.6,
};

const PART_NOUN: Record<PartSport, string> = {
  cycling: "ride",
  running: "run",
  swimming: "swim",
  walking: "walk",
  strength: "strength session",
};

export function partNoun(sport: PartSport) {
  return PART_NOUN[sport];
}

function isRideOrRun(sport: PartSport): sport is "running" | "cycling" {
  return sport === "running" || sport === "cycling";
}

/** Key sessions are rides or runs: that is where zones and watts mean something. */
function hostsKey(sport: DaySport) {
  return sport === "any" || sport === "cycling" || sport === "running";
}

function sportAccepts(sport: DaySport, session: KeySession) {
  if (!hostsKey(sport)) return false;
  return sport === "any" || session.sport === "any" || session.sport === sport;
}

/** How to hold an easy part in a sport without zones or watts in VO2. */
function partHint(sport: PartSport, data: Pick<WeekTargetData, "collectors" | "anchors">) {
  if (isRideOrRun(sport)) return easyCap(sport, data.collectors[sport], data.anchors);
  if (sport === "swimming") return "Long, relaxed strokes; you could keep going.";
  if (sport === "walking") return "Brisk, breathing through your nose.";
  return "Controlled reps, full rest between sets; no intervals.";
}

function partCue(
  sport: PartSport,
  zone: StepZone,
  data: Pick<WeekTargetData, "collectors" | "anchors">,
) {
  if (isRideOrRun(sport)) return zoneCue(zone, sport, data.collectors[sport], data.anchors);
  if (sport === "strength") return "Controlled, no intervals";
  return ZONE_RPE[zone];
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

/** A key session beyond the week mix, for a day the athlete wants to go hard anyway. */
function extraKeySession(data: WeekTargetData & { plan: TrainingPlan }) {
  const [first] = generateKeySessions({
    plan: {
      buildPace: data.plan.buildPace,
      weekMix: { minSessions: 1, maxSessions: 1, keyShare: 100, doubleDays: 0 },
    },
    weekStart: data.weekStart,
    ctl: data.weekStartFitness.ctl,
    targetMinutes: Number.MAX_SAFE_INTEGER,
  });
  return { ...first, id: "extra" };
}

/** Split minutes over parts by sport weight; parts under the minimum are dropped. */
function splitByWeight(total: number, sports: PartSport[]) {
  const weight = sports.reduce((sum, sport) => sum + PART_WEIGHT[sport], 0);
  return sports.map((sport) => round5((total * PART_WEIGHT[sport]) / Math.max(weight, 0.1)));
}

/** One session for today, shaped by what the athlete chose and by what the week still needs. */
export function recommendToday(
  data: WeekTargetData & { plan: TrainingPlan },
  summary: WeekSummary,
  choice: TodayChoice,
): Recommendation {
  const { available, feel } = choice;
  const sports = choice.sports.length
    ? choice.sports.slice(0, MAX_DAY_PARTS)
    : (["any"] as DaySport[]);
  const form = summary.form;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hardYesterday = hardRecently(data.activities, data.today);
  const todaySessions = data.activities.filter(
    (activity) => activity.date === data.today && activity.minutes >= EASY_SESSION_MIN_MINUTES,
  );
  const todayMinutes = todaySessions.reduce((sum, activity) => sum + activity.minutes, 0);

  // The first ride or run part is the only one that can carry a key session.
  const keyIndex = sports.findIndex(hostsKey);
  const keySport = keyIndex >= 0 ? sports[keyIndex] : null;
  const open = keySport
    ? summary.keySessions.filter((status) => !status.done && sportAccepts(keySport, status.session))
    : [];
  const active = summary.paused ? [] : open.filter((status) => !status.skipped);
  const ready = active.filter((status) => !(hardYesterday && isHard(status.session)));
  // The other parts need their own time, so the key session gets what is left,
  // or exactly its share when the athlete set the split.
  const custom = customSplit({ ...choice, sports });
  const keyWindow =
    custom && keyIndex >= 0 ? custom[keyIndex] : available - (sports.length - 1) * PART_MIN_MINUTES;
  const fits = ready.find((status) => status.minutes <= keyWindow + 10) ?? null;

  if (todayMinutes > 0) {
    reasons.push(
      `You already trained ${formatHours(todayMinutes / 60)} today; this is on top of it.`,
    );
  }

  let kind: SessionKind;
  let keySession: KeySession | null = null;
  if (feel === "easy") {
    kind = form < PAUSE_FORM ? "recovery" : "easy";
    if (active.length) {
      reasons.push(
        `Easy today, as you asked. ${keySessionName(active[0].session)} stays open for another day.`,
      );
    }
  } else if (feel === "hard" && !keySport) {
    kind = "easy";
    warnings.push("Key sessions are rides or runs. Add one to today to go hard.");
  } else if (feel === "hard") {
    kind = "key";
    const hard = (status: KeySessionStatus) => isHard(status.session);
    const chosen =
      active.find((status) => hard(status) && status.minutes <= keyWindow + 10) ??
      active.find(hard) ??
      open.find(hard) ??
      null;
    const base = chosen?.session ?? extraKeySession(data);
    keySession = fitKeySession(base, keyWindow);
    if (!chosen) warnings.push("All key sessions are done: this one is extra on top of the week.");
    else if (chosen.skipped) {
      warnings.push(
        "This key session was dropped for lack of days; doing it today brings it back.",
      );
    }
    if (keySession !== base) warnings.push(`Shortened to fit ${formatHours(available / 60)}.`);
    if (hardYesterday) {
      warnings.push("You went hard in the last day. Two hard days in a row cost more recovery.");
    }
    if (summary.paused) {
      warnings.push(
        `Form is ${Math.round(form)}, very fatigued. VO2 would keep today easy; stop early if legs feel heavy.`,
      );
    }
    if (summary.remainingMinutes <= 0) warnings.push("You already hit this week’s target.");
  } else if (summary.remainingMinutes <= 0) {
    kind = form < -10 ? "rest" : "recovery";
    reasons.push("You already hit this week’s target.");
  } else if (summary.paused) {
    kind = "recovery";
    reasons.push(
      `Form is ${Math.round(form)}, very fatigued. Key sessions are paused; bank easy time only.`,
    );
  } else if (fits) {
    kind = "key";
    keySession = fits.session;
    const position = summary.keySessions.indexOf(fits) + 1;
    reasons.push(`Key session ${position} of ${summary.keySessions.length} this week.`);
  } else {
    kind = "easy";
    if (active.length && hardYesterday && ready.length < active.length) {
      reasons.push("Hard work in the last day. Keep today easy.");
    }
    const tooLong = ready.find((status) => status.minutes > keyWindow + 10);
    if (tooLong) {
      reasons.push(
        `${keySessionName(tooLong.session)} needs ${formatHours(tooLong.minutes / 60)}. Save it for a longer window.`,
      );
    }
  }

  // Resolve "Either" parts: the main one by what the week needs, the others to the other sport.
  const mainIndex = kind === "key" && keyIndex >= 0 ? keyIndex : 0;
  const mainChoice = sports[mainIndex];
  const mainSport: PartSport =
    mainChoice === "any" ? pickFamily(summary, available, keySession?.sport) : mainChoice;
  const resolved: PartSport[] = sports.map((sport, index) => {
    if (index === mainIndex) return mainSport;
    if (sport !== "any") return sport;
    return mainSport === "cycling" ? "running" : "cycling";
  });
  if (keySession && isRideOrRun(mainSport)) keySession = { ...keySession, sport: mainSport };

  // Minutes per part.
  let minutesByPart: number[];
  if (kind === "rest") minutesByPart = resolved.map(() => 0);
  else if (custom) minutesByPart = custom.map((minutes) => round5(minutes));
  else if (kind === "key" && keySession) {
    const keyMinutes = keySessionMinutes(keySession);
    const others = resolved.filter((_, index) => index !== mainIndex);
    const shares = splitByWeight(Math.max(0, available - keyMinutes), others);
    let next = 0;
    minutesByPart = resolved.map((_, index) => (index === mainIndex ? keyMinutes : shares[next++]));
  } else {
    const easySize =
      summary.easy.perSession > 0 ? summary.easy.perSession : summary.remainingMinutes;
    // One sport: the easy session's share of the week. Several: the whole time the athlete
    // picked, split by sport. Recovery days stay short whatever the parts.
    const dayMinutes =
      kind === "recovery"
        ? Math.min(available, 45)
        : resolved.length > 1
          ? available
          : Math.min(available, Math.max(30, easySize));
    minutesByPart = splitByWeight(dayMinutes, resolved);
    if (resolved.length === 1 && resolved[0] === "running") {
      minutesByPart[0] = Math.min(minutesByPart[0], 90);
    }
  }
  const parts: DayPart[] = resolved
    .map((sport, index) => ({ sport, minutes: minutesByPart[index], main: index === mainIndex }))
    .filter((part) => part.main || part.minutes >= (custom ? SPLIT_MIN_MINUTES : PART_MIN_MINUTES));

  // Double days: a second session on one date, up to what the week mix allows.
  const { allowed, left } = summary.doubles;
  const isDouble = parts.length > 1 || (todaySessions.length > 0 && kind !== "rest");
  if (isDouble) {
    if (left > 0) reasons.push(`Double day · ${left} of ${allowed} left this week.`);
    else {
      warnings.push(
        allowed > 0
          ? `You already used your ${allowed} double ${allowed === 1 ? "day" : "days"} this week; this one is extra.`
          : "Your week mix has no double days; this one is extra.",
      );
    }
  }

  const main = parts.find((part) => part.main);
  const family = main?.sport ?? mainSport;
  if (kind === "easy" && feel === "auto") {
    const { planned, done, perSession } = summary.easy;
    if (planned > 0 && done < planned) {
      reasons.push(
        `Easy session ${done + 1} of ${planned} · about ${formatHours(perSession / 60)} each.`,
      );
    }
    if (isRideOrRun(family)) {
      const sportLeft = summary.bySport[family].left;
      if (sportLeft > 0) {
        reasons.push(
          `${formatHours(sportLeft / 60)} of ${family === "cycling" ? "riding" : "running"} left this week.`,
        );
      }
    }
    if (summary.pace.status === "behind") {
      reasons.push("Behind your usual pace. Easy time closes the gap without digging a hole.");
    }
    // More easy sessions than single days left: suggest stacking, but let the athlete pick the sport.
    const easyNeeded = planned - done;
    if (parts.length === 1 && left > 0 && easyNeeded > summary.easy.singleDaySlots) {
      reasons.push(
        `${easyNeeded} easy sessions left for ${summary.easy.singleDaySlots} ${summary.easy.singleDaySlots === 1 ? "day" : "days"}: add a second sport today.`,
      );
    }
  }

  return buildRecommendation({ kind, keySession, parts, reasons, warnings }, data, summary);
}

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
    if (kind === "rest") return "Take the day off. The week’s target is already met.";
    if (kind === "recovery") {
      return isRideOrRun(part.sport)
        ? `Zone 1 only, no surges. ${partHint(part.sport, data)}`
        : `Very easy ${noun}. ${partHint(part.sport, data)}`;
    }
    if (keySession && isRideOrRun(part.sport)) {
      const extra = round5(part.minutes - keySessionMinutes(keySession));
      const steady =
        extra >= 5 ? ` Add ${formatHours(extra / 60)} steady Z2 before the cool-down.` : "";
      return `${keySessionDescription(keySession, part.sport, data)}${steady}`;
    }
    return isRideOrRun(part.sport)
      ? `Zone 2 the whole way. ${partHint(part.sport, data)}`
      : `Easy ${noun}. ${partHint(part.sport, data)}`;
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

/** A key session from the week mix, shown on its own page whatever today's window is. */
export function keySessionRecommendation(
  data: WeekTargetData,
  summary: WeekSummary,
  sessionId: string,
): Recommendation | null {
  const status = summary.keySessions.find((item) => item.session.id === sessionId);
  if (!status) return null;
  const family = pickFamily(summary, status.minutes, status.session.sport);
  const reasons = status.done
    ? [`Done with ${status.done.title}.`]
    : status.skipped
      ? ["Dropped this week: more key sessions than training days left."]
      : summary.paused
        ? ["Paused this week: form is very low."]
        : [];
  return buildRecommendation(
    {
      kind: "key",
      keySession: status.session,
      parts: [{ sport: family, minutes: status.minutes, main: true }],
      reasons,
    },
    data,
    summary,
  );
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
    if (!part.main) {
      step(
        part.sport === "strength" ? "Strength" : "Easy",
        part.minutes,
        part.sport === "strength" ? "z1" : "z2",
      );
    } else if (pick.kind === "recovery") step("Recovery", part.minutes, "z1");
    else if (part.sport === "strength") step("Strength", part.minutes, "z1");
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

function recentAverageWeekLoad(history: DayTotal[], weekStart: string) {
  const from = addDayKey(weekStart, -28);
  let load = 0;
  let any = false;
  for (const day of history) {
    if (day.date < from || day.date >= weekStart) continue;
    load += day.load;
    if (day.load > 0) any = true;
  }
  return any ? load / 4 : null;
}

/** Fitness and form if the rest of the target load is spread over the remaining training days. */
export function projectWeek(
  data: WeekTargetData & { plan: TrainingPlan },
  summary: WeekSummary,
): WeekProjection {
  const days: string[] = [];
  for (let offset = 0; offset < summary.daysLeft; offset += 1) {
    days.push(addDayKey(data.today, offset));
  }
  const trainingDays = days.filter(
    (day) =>
      !(
        summary.restDayAhead &&
        days.length > 1 &&
        weekdayOf(day) === data.plan.preferredRestWeekday
      ),
  );
  const share = trainingDays.length ? summary.remainingLoad / trainingDays.length : 0;

  let { ctl, atl } = data.fitness;
  days.forEach((day, index) => {
    const load = trainingDays.includes(day) ? share : 0;
    if (index === 0) {
      ctl += load / CTL_DAYS;
      atl += load / ATL_DAYS;
      return;
    }
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
  });

  const weekLoad = Math.round(summary.doneLoad + summary.remainingLoad);
  const average = recentAverageWeekLoad(data.history, data.weekStart);
  const rampRatio = average && average > 0 ? weekLoad / average : null;
  const formMonday = ctl - atl;
  return {
    fitnessNow: data.fitness.ctl,
    fitnessSunday: ctl,
    formMonday,
    formMondayLabel: formLabel(formMonday),
    weekLoad,
    recentAverageLoad: average == null ? null : Math.round(average),
    rampRatio,
    warn: rampRatio != null && rampRatio > RAMP_WARNING_RATIO,
  };
}

export const loadWeekTarget = createServerFn({ method: "GET" }).handler(
  async (): Promise<WeekTargetData> => {
    const { loadWeekTargetImpl } = await import("./week-target.server.ts");
    return loadWeekTargetImpl();
  },
);
