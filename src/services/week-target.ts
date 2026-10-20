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
  easySessionCount,
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
    /** Easy sessions planned this week, and how many activities already filled one. */
    sessions: number;
    done: number;
    /** Suggested length of each easy session still to do. */
    perSession: number;
  };
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
  family: "running" | "cycling";
  minutes: number;
  /** An easy second part on the other sport, for a "run + ride" day. */
  second: { family: "running" | "cycling"; minutes: number } | null;
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
  const easySessions = easySessionCount(plan.weekMix);
  const easyDone = Math.min(
    easySessions,
    activities.filter(
      (activity) => !usedByKey.has(activity.id) && activity.minutes >= EASY_SESSION_MIN_MINUTES,
    ).length,
  );
  const paused = form < PAUSE_FORM;
  const keyLeftMinutes = paused
    ? 0
    : keySessions
        .filter((status) => !status.done && !status.skipped)
        .reduce((sum, status) => sum + status.minutes, 0);
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
      sessions: easySessions,
      done: easyDone,
      perSession: round5(
        Math.max(0, remainingMinutes - keyLeftMinutes) / Math.max(1, easySessions - easyDone),
      ),
    },
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
  family: "running" | "cycling",
  minutes: number,
  keySession: KeySession | null,
) {
  const noun = family === "cycling" ? "ride" : "run";
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
export const TODAY_SPORTS = [
  { id: "any", label: "Either" },
  { id: "running", label: "Run" },
  { id: "cycling", label: "Ride" },
  { id: "both", label: "Run + ride" },
] as const;

export const TODAY_FEELS = [
  { id: "auto", label: "Let VO2 pick" },
  { id: "easy", label: "Easy" },
  { id: "hard", label: "Hard" },
] as const;

export type TodaySport = (typeof TODAY_SPORTS)[number]["id"];
export type TodayFeel = (typeof TODAY_FEELS)[number]["id"];

/** What the athlete says about today. VO2 adapts to it and warns, it never refuses. */
export type TodayChoice = { available: number; sport: TodaySport; feel: TodayFeel };

export function isDefaultChoice(choice: TodayChoice) {
  return choice.sport === "any" && choice.feel === "auto";
}

/** The second sport of a "run + ride" day takes at least this long, or it is left out. */
const SECOND_PART_MIN_MINUTES = 20;

function sportAccepts(sport: TodaySport, session: KeySession) {
  if (sport === "any" || sport === "both" || session.sport === "any") return true;
  return session.sport === sport;
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
    plan: { buildPace: data.plan.buildPace, weekMix: { sessions: 1, keyShare: 100 } },
    weekStart: data.weekStart,
    ctl: data.weekStartFitness.ctl,
    targetMinutes: Number.MAX_SAFE_INTEGER,
  });
  return { ...first, id: "extra" };
}

/** One session for today, shaped by what the athlete chose and by what the week still needs. */
export function recommendToday(
  data: WeekTargetData & { plan: TrainingPlan },
  summary: WeekSummary,
  choice: TodayChoice,
): Recommendation {
  const { available, sport, feel } = choice;
  const form = summary.form;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const hardYesterday = hardRecently(data.activities, data.today);
  const todayMinutes = data.activities
    .filter((activity) => activity.date === data.today)
    .reduce((sum, activity) => sum + activity.minutes, 0);
  const open = summary.keySessions.filter(
    (status) => !status.done && sportAccepts(sport, status.session),
  );
  const active = summary.paused ? [] : open.filter((status) => !status.skipped);
  const ready = active.filter((status) => !(hardYesterday && isHard(status.session)));
  // On a two-sport day the key session shares the window with the second part.
  const keyWindow = sport === "both" ? available - SECOND_PART_MIN_MINUTES : available;
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
    else if (chosen.skipped)
      warnings.push(
        "This key session was dropped for lack of days; doing it today brings it back.",
      );
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

  // Which sport carries the main part.
  const forced = sport === "running" || sport === "cycling" ? sport : null;
  const family: "running" | "cycling" =
    forced ??
    (sport === "both"
      ? keySession?.sport === "cycling"
        ? "cycling"
        : "running"
      : pickFamily(summary, available, keySession?.sport));
  // Today's session is on the sport the athlete picked, whatever the key session allowed.
  if (forced && keySession) keySession = { ...keySession, sport: forced };

  let minutes: number;
  // How long the whole day should be: the window for a key session, the easy share otherwise.
  let dayMinutes = available;
  if (kind === "rest") minutes = 0;
  else if (kind === "recovery") minutes = Math.min(available, 45);
  else if (kind === "key" && keySession) minutes = keySessionMinutes(keySession);
  else {
    const easySize =
      summary.easy.perSession > 0 ? summary.easy.perSession : summary.remainingMinutes;
    dayMinutes = Math.min(available, Math.max(30, easySize));
    // On a run + ride day the run is the shorter opener.
    minutes = sport === "both" ? Math.min(45, Math.max(20, dayMinutes * 0.35)) : dayMinutes;
    if (family === "running" && sport !== "both") minutes = Math.min(minutes, 90);
  }
  minutes = round5(minutes);

  let second: { family: "running" | "cycling"; minutes: number } | null = null;
  if (sport === "both" && kind !== "rest") {
    const left = round5(dayMinutes - minutes);
    if (left >= SECOND_PART_MIN_MINUTES) {
      second = { family: family === "running" ? "cycling" : "running", minutes: left };
    }
  }

  if (kind === "easy" && feel === "auto") {
    const { sessions, done, perSession } = summary.easy;
    if (sessions > 0 && done < sessions) {
      reasons.push(
        `Easy session ${done + 1} of ${sessions} · about ${formatHours(perSession / 60)} each.`,
      );
    }
    const left = summary.bySport[family].left;
    if (left > 0) {
      reasons.push(
        `${formatHours(left / 60)} of ${family === "cycling" ? "riding" : "running"} left this week.`,
      );
    }
    if (summary.pace.status === "behind") {
      reasons.push("Behind your usual pace. Easy time closes the gap without digging a hole.");
    }
  }

  return buildRecommendation(
    { kind, keySession, family, minutes, reasons, warnings, second },
    data,
    summary,
  );
}

/** Load, effect on the week, and wording for a chosen session. */
export function buildRecommendation(
  pick: {
    kind: SessionKind;
    keySession: KeySession | null;
    family: "running" | "cycling";
    minutes: number;
    reasons: string[];
    warnings?: string[];
    second?: { family: "running" | "cycling"; minutes: number } | null;
  },
  data: WeekTargetData,
  summary: WeekSummary,
): Recommendation {
  const { kind, keySession, family, minutes, reasons } = pick;
  const second = pick.second ?? null;
  const intensity =
    kind === "key" && keySession
      ? keySessionIntensity(keySession)
      : kind === "recovery"
        ? RECOVERY_INTENSITY
        : EASY_INTENSITY;
  // Scale a generic session by how costly an hour usually is for this athlete.
  const perHour = summary.loadPerHour / stress(60, EASY_INTENSITY);
  const load = Math.round(
    (stress(minutes, intensity) + (second ? stress(second.minutes, EASY_INTENSITY) : 0)) * perHour,
  );
  const ctl = data.fitness.ctl + load / CTL_DAYS;
  const atl = data.fitness.atl + load / ATL_DAYS;
  const formTomorrow = ctl - atl;

  const collectors = data.collectors[family];
  const main =
    kind === "rest"
      ? "Take the day off. The week’s target is already met."
      : kind === "recovery"
        ? `Zone 1 only, no surges. ${easyCap(family, collectors, data.anchors)}`
        : keySession
          ? keySessionDescription(keySession, family, data)
          : `Zone 2 the whole way. ${easyCap(family, collectors, data.anchors)}`;
  const then = second
    ? ` Then ${formatHours(second.minutes / 60)} easy ${second.family === "cycling" ? "ride" : "run"}: ${easyCap(second.family, data.collectors[second.family], data.anchors)}`
    : "";
  const title = sessionTitle(kind, family, minutes, keySession);

  return {
    kind,
    keySession,
    family,
    minutes,
    second,
    title: second ? `${title} + easy ${second.family === "cycling" ? "ride" : "run"}` : title,
    description: `${main}${then}`,
    reasons,
    warnings: pick.warnings ?? [],
    load,
    after: {
      remainingMinutes: Math.max(0, summary.remainingMinutes - minutes - (second?.minutes ?? 0)),
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
    { kind: "key", keySession: status.session, family, minutes: status.minutes, reasons },
    data,
    summary,
  );
}

export type SessionStep = {
  label: string;
  minutes: number;
  zone: StepZone;
  cue: string;
  family: "running" | "cycling";
  /** Set on the hard part of a key session. */
  work: boolean;
};

/** Minute-by-minute shape of a session, for the profile chart and the steps table. */
export function sessionSteps(
  pick: Pick<Recommendation, "kind" | "keySession" | "family" | "minutes" | "second">,
  data: Pick<WeekTargetData, "collectors" | "anchors">,
): SessionStep[] {
  const step = (
    label: string,
    minutes: number,
    zone: StepZone,
    work = false,
    family = pick.family,
  ): SessionStep => ({
    label,
    minutes,
    zone,
    cue: zoneCue(zone, family, data.collectors[family], data.anchors),
    family,
    work,
  });
  const session = pick.keySession;
  const steps: SessionStep[] = [];
  if (pick.kind === "rest" || pick.minutes <= 0) return steps;
  if (pick.kind === "recovery") steps.push(step("Recovery", pick.minutes, "z1"));
  else if (pick.kind === "easy" || !session || session.kind === "long") {
    if (pick.minutes < 40) steps.push(step("Steady", pick.minutes, "z2", Boolean(session)));
    else {
      steps.push(
        step("Ease in", 10, "z1"),
        step("Steady", pick.minutes - 20, "z2", Boolean(session)),
        step("Ease out", 10, "z1"),
      );
    }
  } else {
    steps.push(step("Warm-up", WARM_UP_MINUTES, "z1"));
    for (let rep = 1; rep <= session.reps; rep += 1) {
      const label = session.reps === 1 ? "Main block" : `Rep ${rep} of ${session.reps}`;
      steps.push(step(label, session.workMinutes, session.zone, true));
      if (rep < session.reps && session.restMinutes > 0) {
        steps.push(step("Easy", session.restMinutes, "z1"));
      }
    }
    steps.push(step("Cool-down", COOL_DOWN_MINUTES, "z1"));
  }
  const second = pick.second;
  if (second) {
    const noun = second.family === "cycling" ? "ride" : "run";
    steps.push(step(`Easy ${noun}`, second.minutes, "z2", false, second.family));
  }
  return steps;
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
