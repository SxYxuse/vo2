import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";
import { z } from "zod";

import { sportGroupFor } from "./sport-groups.ts";
import {
  averageWeeklyMovingSeconds,
  buildPmc,
  slicePmc,
  type FitnessLoad,
} from "./training-load.ts";

export const BUILD_PACES = [
  {
    id: "hold",
    label: "Hold",
    hint: "Keep fitness about where it is and stay fresher.",
    ramp: 0,
    risk: "Low fatigue",
  },
  {
    id: "slow",
    label: "Build slowly",
    hint: "Gentle fitness rise you can hold for months.",
    ramp: 3,
    risk: "Sustainable",
  },
  {
    id: "steady",
    label: "Build steadily",
    hint: "Normal progression. Some fatigue is expected.",
    ramp: 5,
    risk: "Normal load",
  },
  {
    id: "fast",
    label: "Build fast",
    hint: "Aggressive. Form will sit negative more often.",
    ramp: 8,
    risk: "High fatigue",
  },
  {
    id: "overreach",
    label: "Overreach",
    hint: "Very fast fitness jump. Dangerous if it lasts — short blocks only.",
    ramp: 12,
    risk: "Injury risk",
  },
] as const;

export type BuildPace = (typeof BUILD_PACES)[number]["id"];

export const HOURS_INTENTS = [
  { id: "lower", label: "Cut back", factor: 0.85 },
  { id: "keep", label: "Keep this volume", factor: 1 },
  { id: "higher", label: "Add hours", factor: 1.15 },
] as const;

export type HoursIntent = (typeof HOURS_INTENTS)[number]["id"];

export const WORKOUT_STYLES = [
  {
    id: "hours",
    label: "Hours of training",
    hint: "Easy and long aerobic. The bucket stays volume — no intervals.",
  },
  {
    id: "structured",
    label: "Intervals and zones",
    hint: "Threshold, VO2, and tempo when form allows. Watts, heart rate, or RPE from the collectors on each sport.",
  },
] as const;

export type WorkoutStyle = (typeof WORKOUT_STYLES)[number]["id"];
export type QualityKind = "threshold" | "vo2" | "tempo";
export type FamilyCollectors = {
  heartRate: boolean;
  power: boolean;
  powerPartial: boolean;
};

export type TestAnchors = {
  ftpWatts: number | null;
  cyclingLthr: number | null;
  cyclingMaxHr: number | null;
  runLthr: number | null;
  runMaxHr: number | null;
};

export const WEEKDAYS = [
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
  { id: 0, label: "Sunday" },
] as const;

export const TIME_WINDOWS = [
  { minutes: 0, label: "Any" },
  { minutes: 45, label: "45 min" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1h 30" },
  { minutes: 120, label: "2h" },
  { minutes: 180, label: "3h" },
] as const;

export const trainingPlanSchema = z.object({
  buildPace: z.enum(["hold", "slow", "steady", "fast", "overreach"]),
  maxRunSessions: z.number().int().min(0).max(7),
  maxRideSessions: z.number().int().min(0).max(7),
  maxDoubleDays: z.number().int().min(0).max(6).default(0),
  hoursIntent: z.enum(["lower", "keep", "higher"]),
  workoutStyle: z.enum(["hours", "structured"]).default("hours"),
  targetWeeklyHours: z.number().min(0.5).max(30),
  preferredRestWeekday: z.number().int().min(0).max(6),
  suggestFtpTest: z.boolean().default(true),
  suggestBeepTest: z.boolean().default(true),
  suggestRunLthrTest: z.boolean().default(true),
  timeZone: z.string().min(1),
});

export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

export type PlannedSession = {
  id: string;
  date: string;
  weekStart: string;
  sportFamily: "running" | "cycling";
  title: string;
  targetMinutes: number;
  targetLoad: number;
  status: "planned" | "done" | "adapted";
  note: string | null;
  activityId: string | null;
  activityTitle: string | null;
};

const ASSESSMENT_TITLES = new Set(["ftp test", "ftp ramp", "ftp 20-min", "beep test", "run lthr"]);

export function isAssessmentSession(session: { title: string }) {
  return ASSESSMENT_TITLES.has(session.title.trim().toLowerCase());
}

export type CompletedSession = {
  date: string;
  family: "running" | "cycling" | "other";
  minutes: number;
  load: number;
};

const TSS_PER_HOUR = 42;
const CTL_DAYS = 42;

function withPlanDefaults(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  return {
    ...raw,
    maxDoubleDays:
      typeof raw.maxDoubleDays === "number" ? raw.maxDoubleDays : raw.allowDoubles === true ? 6 : 0,
    suggestFtpTest: raw.suggestFtpTest !== false,
    suggestBeepTest: raw.suggestBeepTest !== false,
    suggestRunLthrTest: raw.suggestRunLthrTest !== false,
    workoutStyle: raw.workoutStyle === "structured" ? "structured" : "hours",
  };
}

export function parseTrainingPlan(value: unknown): TrainingPlan | null {
  const parsed = trainingPlanSchema.safeParse(withPlanDefaults(value));
  return parsed.success ? parsed.data : null;
}

export function isTrainingPlanComplete(value: unknown): value is TrainingPlan {
  const plan = parseTrainingPlan(value);
  return Boolean(plan && trainingConsistency(plan).ok);
}

export function trainingConsistency(
  plan: Pick<TrainingPlan, "maxRunSessions" | "maxRideSessions" | "targetWeeklyHours">,
) {
  const sessions = plan.maxRunSessions + plan.maxRideSessions;
  if (sessions <= 0) {
    return { ok: false, message: "Plan at least one run or ride each week." };
  }
  const minHours = sessions * 0.45;
  const maxHours = sessions * 2.75;
  if (plan.targetWeeklyHours < minHours) {
    return {
      ok: false,
      message: `${sessions} sessions is a lot for ${formatHours(plan.targetWeeklyHours)} a week. Cut sessions or add hours.`,
    };
  }
  if (plan.targetWeeklyHours > maxHours) {
    return {
      ok: false,
      message: `${formatHours(plan.targetWeeklyHours)} needs longer or extra sessions to stay realistic.`,
    };
  }
  return { ok: true, message: null };
}

export function suggestedTargetHours(avgWeeklyHours: number, intent: HoursIntent) {
  const factor = HOURS_INTENTS.find((item) => item.id === intent)?.factor ?? 1;
  const base = avgWeeklyHours > 0.5 ? avgWeeklyHours : 5;
  return Math.round(base * factor * 10) / 10;
}

export function recentAverageWeeklyHours(loads: FitnessLoad[], timeZone: string) {
  const pmc = buildPmc(loads, timeZone);
  const series = slicePmc(pmc, "3m", timeZone);
  return averageWeeklyMovingSeconds(loads, series, timeZone) / 3600;
}

export function formatHours(hours: number) {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}`;
}

export function sportFamilyOf(sportType: string): CompletedSession["family"] {
  const group = sportGroupFor(sportType)?.id;
  if (group === "running") return "running";
  if (group === "cycling") return "cycling";
  return "other";
}

function toZoned(date: Date, timeZone: string) {
  return new TZDate(date.getTime(), timeZone);
}

export function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function weekStartKey(date: Date, timeZone: string) {
  const zoned = startOfDay(toZoned(date, timeZone));
  const weekday = zoned.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return dayKey(addDays(zoned, -offset), timeZone);
}

export function addDayKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function sessionFitsWindow(targetMinutes: number, availableMinutes: number) {
  if (availableMinutes <= 0) return true;
  return targetMinutes <= availableMinutes + 10;
}

export type MatchableActivity = {
  id: string;
  date: string;
  family: CompletedSession["family"];
  minutes: number;
  load: number;
};

export type SessionActivityMatch = {
  sessionId: string;
  activityId: string;
  date: string;
};

const QUALITY_SESSION_RE = /\bvo2\b|threshold|tempo|sweet-spot/;
const LONG_SESSION_RE = /\blong\b/;

export function sessionRole(title: string): "quality" | "long" | "easy" {
  const normalized = title.trim().toLowerCase();
  if (QUALITY_SESSION_RE.test(normalized)) return "quality";
  if (LONG_SESSION_RE.test(normalized)) return "long";
  return "easy";
}

export function durationFitsPlan(actualMinutes: number, targetMinutes: number) {
  if (targetMinutes <= 0 || actualMinutes <= 0) return false;
  const ratio = actualMinutes / targetMinutes;
  return ratio >= 0.55 && ratio <= 1.6;
}

function matchScore(activity: MatchableActivity, session: PlannedSession) {
  if (activity.family !== session.sportFamily) return -1;
  if (!durationFitsPlan(activity.minutes, session.targetMinutes)) return -1;
  const durationError = Math.abs(activity.minutes - session.targetMinutes) / session.targetMinutes;
  const durationScore = 1 - Math.min(1, durationError);
  const hours = activity.minutes / 60;
  const intensity = hours > 0 ? activity.load / hours : 0;
  const role = sessionRole(session.title);
  if (role === "quality") return durationScore * 2 + Math.min(intensity, 120) / 120;
  if (role === "long")
    return durationScore + Math.min(activity.minutes / session.targetMinutes, 1.2);
  return durationScore * 1.5 - Math.min(intensity, 80) / 200;
}

export function assignActivitiesToSessions(
  weekActivities: MatchableActivity[],
  sessions: PlannedSession[],
): SessionActivityMatch[] {
  const linked = new Set(
    sessions.map((session) => session.activityId).filter((id): id is string => Boolean(id)),
  );
  const open = sessions
    .filter(
      (session) =>
        session.status !== "done" && !session.activityId && !isAssessmentSession(session),
    )
    .sort((left, right) => {
      const order = { quality: 0, long: 1, easy: 2 } as const;
      const byRole = order[sessionRole(left.title)] - order[sessionRole(right.title)];
      if (byRole !== 0) return byRole;
      return right.targetMinutes - left.targetMinutes;
    });
  const usedActivities = new Set<string>();
  const matches: SessionActivityMatch[] = [];
  for (const session of open) {
    let best: { activity: MatchableActivity; score: number } | null = null;
    for (const activity of weekActivities) {
      if (linked.has(activity.id) || usedActivities.has(activity.id)) continue;
      if (activity.family === "other") continue;
      const score = matchScore(activity, session);
      if (score < 0) continue;
      if (!best || score > best.score) best = { activity, score };
    }
    if (!best) continue;
    usedActivities.add(best.activity.id);
    matches.push({
      sessionId: session.id,
      activityId: best.activity.id,
      date: best.activity.date,
    });
  }
  return matches;
}

export function openWeekBucket(sessions: PlannedSession[], weekStart: string) {
  return sessions
    .filter(
      (session) =>
        session.weekStart === weekStart &&
        session.status !== "done" &&
        !isAssessmentSession(session),
    )
    .sort((left, right) => right.targetMinutes - left.targetMinutes);
}

export function doneWeekSessions(sessions: PlannedSession[], weekStart: string) {
  return sessions
    .filter(
      (session) =>
        session.weekStart === weekStart &&
        session.status === "done" &&
        !isAssessmentSession(session),
    )
    .sort(
      (left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title),
    );
}

function rampFor(plan: TrainingPlan, tsb: number) {
  let pace = plan.buildPace;
  if (tsb < -25) pace = "hold";
  else if (tsb < -10 && pace === "overreach") pace = "fast";
  else if (tsb < -18 && (pace === "fast" || pace === "overreach")) pace = "steady";
  return BUILD_PACES.find((item) => item.id === pace)?.ramp ?? 0;
}

function weeklyLoadTarget(ctl: number, ramp: number, hours: number) {
  const fromFitness = Math.max(0, 7 * ctl + CTL_DAYS * ramp);
  const fromHours = hours * TSS_PER_HOUR;
  if (ctl <= 5) return fromHours;
  return fromFitness * 0.55 + fromHours * 0.45;
}

type Draft = Omit<PlannedSession, "id">;

function remainingDaysInWeek(today: string, weekEnd: string) {
  const start = Date.parse(`${today}T12:00:00Z`);
  const end = Date.parse(`${weekEnd}T12:00:00Z`);
  if (end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function planRemainingWeek(input: {
  plan: TrainingPlan;
  today: string;
  ctl: number;
  tsb: number;
  completed: CompletedSession[];
  collectors?: { running: FamilyCollectors; cycling: FamilyCollectors };
  anchors?: TestAnchors;
}): Draft[] {
  const weekStart = weekStartKey(new Date(`${input.today}T12:00:00`), input.plan.timeZone);
  const weekEnd = addDayKey(weekStart, 6);
  const ramp = rampFor(input.plan, input.tsb);
  const weekLoad = weeklyLoadTarget(input.ctl, ramp, input.plan.targetWeeklyHours);
  const weekCompleted = input.completed.filter(
    (session) => session.date >= weekStart && session.date <= weekEnd,
  );
  const completedLoad = weekCompleted.reduce((sum, session) => sum + session.load, 0);
  const remainingLoad = Math.max(20, weekLoad - completedLoad);
  const minutesTotal = Math.max(
    30,
    Math.round(input.plan.targetWeeklyHours * 60) -
      weekCompleted.reduce((sum, session) => sum + session.minutes, 0),
  );

  let runLeft = Math.max(
    0,
    input.plan.maxRunSessions -
      weekCompleted.filter((session) => session.family === "running").length,
  );
  let rideLeft = Math.max(
    0,
    input.plan.maxRideSessions -
      weekCompleted.filter((session) => session.family === "cycling").length,
  );

  let daysLeft = remainingDaysInWeek(input.today, weekEnd);
  if (input.tsb < -25) daysLeft = Math.max(0, daysLeft - 1);
  const capacity = daysLeft + Math.min(input.plan.maxDoubleDays, daysLeft);

  const queue: Array<"running" | "cycling"> = [];
  while (runLeft > 0 || rideLeft > 0) {
    if (rideLeft > 0 && (rideLeft >= runLeft || runLeft === 0)) {
      queue.push("cycling");
      rideLeft -= 1;
    } else if (runLeft > 0) {
      queue.push("running");
      runLeft -= 1;
    } else {
      break;
    }
  }
  const slots = queue.slice(0, capacity);
  if (!slots.length) return [];

  const extras = Math.max(0, slots.length - daysLeft);
  const brickFrom = extras > 0 ? slots.length - extras : slots.length;
  const lastPrimary = (family: "running" | "cycling") => {
    for (let index = brickFrom - 1; index >= 0; index -= 1) {
      if (slots[index] === family) return index;
    }
    return -1;
  };
  const longIndex =
    brickFrom > 1
      ? lastPrimary("cycling") >= 0
        ? lastPrimary("cycling")
        : lastPrimary("running")
      : -1;

  const kind = qualityWork(input.plan, input.tsb);
  const qualityIndex =
    kind && brickFrom >= 2
      ? (() => {
          const run = slots.findIndex(
            (family, index) => index < brickFrom && index !== longIndex && family === "running",
          );
          if (run >= 0) return run;
          return slots.findIndex((_, index) => index < brickFrom && index !== longIndex);
        })()
      : -1;

  const weights = slots.map((_, index) => {
    if (index >= brickFrom) return 0.55;
    if (index === longIndex) return 1.45;
    return 1;
  });
  const weightSum = weights.reduce((sum, value) => sum + value, 0);

  return slots.map((family, index) => {
    const share = weights[index] / weightSum;
    const brick = index >= brickFrom;
    const isLong = index === longIndex && !brick;
    const isQuality = index === qualityIndex && !brick;
    const minutes = Math.max(brick ? 20 : 30, Math.round((minutesTotal * share) / 5) * 5);
    const collectors = input.collectors?.[family];
    const load = Math.max(brick ? 6 : 8, Math.round(remainingLoad * share * 10) / 10);
    return {
      date: weekStart,
      weekStart,
      sportFamily: family,
      title: sessionTitle(family, isLong, isQuality, brick, kind),
      targetMinutes: minutes,
      targetLoad: isQuality && kind ? Math.round(load * 1.25 * 10) / 10 : load,
      status: "planned" as const,
      note: sessionNote(
        input.plan,
        input.tsb,
        isLong,
        isQuality,
        brick,
        kind,
        collectors,
        minutes,
        family,
        input.anchors,
      ),
      activityId: null,
      activityTitle: null,
    };
  });
}

function qualityWork(plan: TrainingPlan, tsb: number): QualityKind | null {
  if (plan.workoutStyle !== "structured") return null;
  if (plan.buildPace === "hold" || tsb < 5) return null;
  if ((plan.buildPace === "fast" || plan.buildPace === "overreach") && tsb >= 10) return "vo2";
  if (plan.buildPace === "slow") return "tempo";
  return "threshold";
}

function rangeLabel(low: number, high: number, unit: string) {
  if (low === high) return `${low} ${unit}`;
  return `${low}–${high} ${unit}`;
}

function pctRange(anchor: number, lowPct: number, highPct: number, unit: string) {
  return rangeLabel(Math.round(anchor * lowPct), Math.round(anchor * highPct), unit);
}

function familyLthr(family: "running" | "cycling", anchors: TestAnchors | undefined) {
  return family === "cycling" ? (anchors?.cyclingLthr ?? null) : (anchors?.runLthr ?? null);
}

function familyMaxHr(family: "running" | "cycling", anchors: TestAnchors | undefined) {
  return family === "cycling" ? (anchors?.cyclingMaxHr ?? null) : (anchors?.runMaxHr ?? null);
}

function powerCue(kind: QualityKind, ftpWatts: number | null) {
  if (ftpWatts) {
    if (kind === "vo2") return `at ${pctRange(ftpWatts, 1.1, 1.2, "W")}`;
    if (kind === "tempo") return `at ${pctRange(ftpWatts, 0.88, 0.94, "W")}`;
    return `at ${pctRange(ftpWatts, 0.95, 1, "W")}`;
  }
  if (kind === "vo2") return "at 110–120% FTP";
  if (kind === "tempo") return "at 88–94% FTP";
  return "at 95–100% FTP";
}

function heartCue(
  kind: QualityKind,
  family: "running" | "cycling",
  anchors: TestAnchors | undefined,
) {
  const lthr = familyLthr(family, anchors);
  const maxHr = familyMaxHr(family, anchors);
  if (kind === "vo2") {
    if (maxHr) return `at ~${Math.round(maxHr * 0.95)} bpm`;
    return "at ~95% max HR";
  }
  if (kind === "tempo") {
    if (lthr) return `at ${pctRange(lthr, 0.9, 0.94, "bpm")}`;
    return "at 90–94% LTHR";
  }
  if (lthr) return `at ${lthr} bpm`;
  return "at LTHR";
}

function intensityCue(
  kind: QualityKind,
  family: "running" | "cycling",
  collectors: FamilyCollectors | undefined,
  anchors: TestAnchors | undefined,
) {
  if (collectors?.power) return powerCue(kind, anchors?.ftpWatts ?? null);
  if (collectors?.heartRate) return heartCue(kind, family, anchors);
  if (kind === "vo2") return "at RPE 9, still controlled";
  if (kind === "tempo") return "at RPE 6–7";
  return "at RPE 8, even effort";
}

function mixedCollectorNote(kind: QualityKind, anchors: TestAnchors | undefined) {
  const hr = heartCue(kind, "cycling", anchors);
  const numbered = /\d/.test(hr);
  if (numbered) {
    return ` Use those watts on bikes with a meter; ${hr.replace(/^at /, "")} on the others.`;
  }
  return " Use power on bikes you marked with a meter; heart rate or RPE on the others.";
}

function mainSet(kind: QualityKind, family: "running" | "cycling", minutes: number, cue: string) {
  const budget = Math.max(20, minutes - 25);
  if (kind === "vo2") {
    const reps = Math.min(6, Math.max(4, Math.floor(budget / 6)));
    return `${reps} × 3 min ${cue}, 3 min easy.`;
  }
  if (kind === "tempo") {
    const on = family === "cycling" ? 12 : 8;
    const reps = Math.min(3, Math.max(2, Math.floor(budget / (on + 4))));
    return `${reps} × ${on} min ${cue}, 4 min easy.`;
  }
  const on = family === "cycling" ? 8 : 6;
  const reps = Math.min(5, Math.max(3, Math.floor(budget / (on + 4))));
  return `${reps} × ${on} min ${cue}, 4 min easy.`;
}

function sessionTitle(
  family: "running" | "cycling",
  isLong: boolean,
  isQuality: boolean,
  isBrick: boolean,
  kind: QualityKind | null,
) {
  if (isBrick && family === "running") return "Brick run";
  if (isBrick && family === "cycling") return "Second ride";
  if (family === "running") {
    if (isLong) return "Long run";
    if (isQuality && kind === "vo2") return "VO2 run";
    if (isQuality && kind === "tempo") return "Tempo run";
    if (isQuality && kind === "threshold") return "Threshold run";
    if (isQuality) return "Steady run";
    return "Easy run";
  }
  if (isLong) return "Long ride";
  if (isQuality && kind === "vo2") return "VO2 ride";
  if (isQuality && kind === "tempo") return "Sweet-spot ride";
  if (isQuality && kind === "threshold") return "Threshold ride";
  if (isQuality) return "Endurance ride";
  return "Easy ride";
}

function sessionNote(
  plan: TrainingPlan,
  tsb: number,
  isLong: boolean,
  isQuality: boolean,
  isBrick: boolean,
  kind: QualityKind | null,
  collectors: FamilyCollectors | undefined,
  minutes: number,
  family: "running" | "cycling",
  anchors: TestAnchors | undefined,
) {
  const pace = BUILD_PACES.find((item) => item.id === plan.buildPace)?.label ?? plan.buildPace;
  if (isBrick)
    return "Shorter extra session. Stack it on a day you already train, and keep it easy.";
  if (tsb < -20) return `Form is low. Kept this easy under your ${pace.toLowerCase()} goal.`;
  if (isQuality && kind) {
    const cue = intensityCue(kind, family, collectors, anchors);
    const mixed = collectors?.powerPartial ? mixedCollectorNote(kind, anchors) : "";
    return `15 min easy. ${mainSet(kind, family, minutes, cue)} 10 min easy.${mixed}`;
  }
  if (isQuality)
    return `Quality session while form allows it (${pace.toLowerCase()}). Pick any day.`;
  if (isLong)
    return `Aerobic volume for the ${pace.toLowerCase()} block. Do it when you have the time.`;
  return `${pace} week · easy aerobic. Fill it on any open day.`;
}

export function latestPmc(loads: FitnessLoad[], timeZone: string) {
  const pmc = buildPmc(loads, timeZone);
  return pmc.at(-1) ?? { ctl: 0, atl: 0, tsb: 0, date: dayKey(new Date(), timeZone) };
}
