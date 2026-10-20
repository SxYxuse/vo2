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

export const HR_TARGET_ZONES = ["z2", "z3", "z4", "z5"] as const;
export type TargetZone = (typeof HR_TARGET_ZONES)[number];

export const keySessionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["intervals", "zone", "long"]),
  sport: z.enum(["cycling", "running", "any"]),
  reps: z
    .number()
    .int()
    .min(1, { error: "At least 1 rep." })
    .max(20, { error: "20 reps at most." }),
  workMinutes: z
    .number()
    .min(1, { error: "At least 1 minute." })
    .max(300, { error: "5 hours at most." }),
  zone: z.enum(HR_TARGET_ZONES),
  restMinutes: z.number().min(0).max(30, { error: "30 minutes at most." }),
});

export type KeySession = z.infer<typeof keySessionSchema>;
export type KeySessionKind = KeySession["kind"];

/** Generated key sessions are capped here whatever the split says. */
export const MAX_KEY_SESSIONS = 4;
export const KEY_SHARE_PRESETS = [
  { share: 0, label: "All easy" },
  { share: 20, label: "20 / 80" },
  { share: 30, label: "30 / 70" },
  { share: 50, label: "50 / 50" },
] as const;

/** How many sessions a week, and what share of them are key sessions. */
export const weekMixSchema = z.object({
  sessions: z
    .number()
    .int()
    .min(1, { error: "At least 1 session a week." })
    .max(14, { error: "14 sessions a week at most." }),
  keyShare: z.number().int().min(0).max(100),
});

export type WeekMix = z.infer<typeof weekMixSchema>;

export const DEFAULT_WEEK_MIX: WeekMix = { sessions: 5, keyShare: 20 };

export function keySessionCount(mix: WeekMix) {
  return Math.min(MAX_KEY_SESSIONS, Math.round((mix.sessions * mix.keyShare) / 100));
}

export function easySessionCount(mix: WeekMix) {
  return Math.max(0, mix.sessions - keySessionCount(mix));
}
export const WARM_UP_MINUTES = 15;
export const COOL_DOWN_MINUTES = 10;

export const KEY_SESSION_PRESETS = [
  {
    id: "vo2",
    label: "VO2 intervals",
    session: { kind: "intervals", reps: 5, workMinutes: 4, zone: "z5", restMinutes: 3 },
  },
  {
    id: "threshold",
    label: "Threshold intervals",
    session: { kind: "intervals", reps: 3, workMinutes: 10, zone: "z4", restMinutes: 5 },
  },
  {
    id: "tempo",
    label: "Tempo block",
    session: { kind: "zone", reps: 2, workMinutes: 20, zone: "z3", restMinutes: 5 },
  },
  {
    id: "long",
    label: "Long Z2",
    session: { kind: "long", reps: 1, workMinutes: 150, zone: "z2", restMinutes: 0 },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  session: Omit<KeySession, "id" | "sport">;
}>;

export type KeySessionPresetId = (typeof KEY_SESSION_PRESETS)[number]["id"];

export function keySessionFromPreset(
  preset: KeySessionPresetId,
  id: string,
  sport: KeySession["sport"] = "any",
): KeySession {
  const found = KEY_SESSION_PRESETS.find((item) => item.id === preset) ?? KEY_SESSION_PRESETS[0];
  return { id, sport, ...found.session };
}

/** Minutes at the target zone. */
export function keySessionWorkMinutes(session: KeySession) {
  return session.kind === "long" ? session.workMinutes : session.reps * session.workMinutes;
}

/** Whole session, warm-up and cool-down included. */
export function keySessionMinutes(session: KeySession) {
  if (session.kind === "long") return session.workMinutes;
  return (
    WARM_UP_MINUTES +
    session.reps * session.workMinutes +
    Math.max(0, session.reps - 1) * session.restMinutes +
    COOL_DOWN_MINUTES
  );
}

export function zoneLabel(zone: TargetZone | "z1") {
  return zone.toUpperCase();
}

export function keySessionName(session: KeySession) {
  const zone = zoneLabel(session.zone);
  if (session.kind === "long") return `Long ${zone}`;
  if (session.reps === 1) return `${session.workMinutes} min ${zone}`;
  return `${session.reps} × ${session.workMinutes} min ${zone}`;
}

/** Plans saved before the week mix: "Intervals and zones" keeps some key sessions. */
function legacyWeekMix(raw: Record<string, unknown>): WeekMix {
  if (Array.isArray(raw.keySessions)) {
    return { sessions: 5, keyShare: Math.min(100, raw.keySessions.length * 20) };
  }
  if (raw.workoutStyle !== "structured" || raw.buildPace === "hold") {
    return { ...DEFAULT_WEEK_MIX, keyShare: 0 };
  }
  const fast = raw.buildPace === "fast" || raw.buildPace === "overreach";
  return { sessions: 5, keyShare: fast ? 40 : 20 };
}

export type FamilyCollectors = {
  heartRate: boolean;
  power: boolean;
  powerPartial: boolean;
};

export type PlanningAnchors = {
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

export const TARGET_MODES = [
  {
    id: "auto",
    label: "From build pace",
    hint: "VO2 sets the hours each week from your fitness and build pace.",
  },
  {
    id: "manual",
    label: "Fixed hours",
    hint: "You pick the hours. Load still follows your build pace.",
  },
] as const;

export type TargetMode = (typeof TARGET_MODES)[number]["id"];

export const trainingPlanSchema = z.object({
  buildPace: z.enum(["hold", "slow", "steady", "fast", "overreach"]),
  targetMode: z.enum(["auto", "manual"]).default("auto"),
  hoursIntent: z.enum(["lower", "keep", "higher"]),
  weekMix: weekMixSchema.default(DEFAULT_WEEK_MIX),
  targetWeeklyHours: z.number().min(0.5).max(30),
  preferredRestWeekday: z.number().int().min(0).max(6),
  timeZone: z.string().min(1),
});

export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

/** Load per hour of mostly aerobic work, used until the athlete has history. */
export const DEFAULT_LOAD_PER_HOUR = 42;

function withPlanDefaults(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  return {
    ...raw,
    targetMode: raw.targetMode === "manual" ? "manual" : "auto",
    weekMix: raw.weekMix && typeof raw.weekMix === "object" ? raw.weekMix : legacyWeekMix(raw),
  };
}

export function parseTrainingPlan(value: unknown): TrainingPlan | null {
  const parsed = trainingPlanSchema.safeParse(withPlanDefaults(value));
  return parsed.success ? parsed.data : null;
}

export function isTrainingPlanComplete(value: unknown): value is TrainingPlan {
  return parseTrainingPlan(value) != null;
}

export function suggestedTargetHours(avgWeeklyHours: number, intent: HoursIntent) {
  const factor = HOURS_INTENTS.find((item) => item.id === intent)?.factor ?? 1;
  const base = avgWeeklyHours > 0.5 ? avgWeeklyHours : 5;
  return Math.round(base * factor * 10) / 10;
}

/** Last-3-month average below this is not a usable hours-intent baseline. */
const THIN_WEEKLY_HOURS = 0.2;

export function hasRecentWeeklyHours(avgHours: number) {
  return avgHours > THIN_WEEKLY_HOURS;
}

export function recentAverageWeeklyHours(loads: FitnessLoad[], timeZone: string) {
  const pmc = buildPmc(loads, timeZone);
  const series = slicePmc(pmc, "3m", timeZone);
  return averageWeeklyMovingSeconds(loads, series, timeZone) / 3600;
}

/** Activities a week over the last 8 weeks; null when there is too little history. */
export function recentSessionsPerWeek(loads: FitnessLoad[], now = new Date()) {
  const from = now.getTime() - 56 * 86_400_000;
  const count = loads.filter((load) => new Date(load.start).getTime() >= from).length;
  return count >= 3 ? count / 8 : null;
}

export function formatHours(hours: number) {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}`;
}

export type SportFamily = "running" | "cycling" | "other";

export function sportFamilyOf(sportType: string): SportFamily {
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

export function latestPmc(loads: FitnessLoad[], timeZone: string) {
  const pmc = buildPmc(loads, timeZone);
  return pmc.at(-1) ?? { ctl: 0, atl: 0, tsb: 0, date: dayKey(new Date(), timeZone) };
}
