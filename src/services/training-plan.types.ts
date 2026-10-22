import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";
import { z } from "zod";

import { sportGroupFor } from "./sport-groups.ts";
import { buildPmc, dayKey, periodStartMs, type FitnessLoad } from "./training-load.ts";

export { dayKey };

/** Which key session types lead a week; the season phase picks one (ADR 0021). */
export type BuildPace = "hold" | "slow" | "steady" | "fast" | "overreach";

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

export const MAX_SESSIONS_PER_WEEK = 14;

/** A range of sessions a week, and what share of them are key sessions. */
export const weekMixSchema = z
  .object({
    minSessions: z
      .number()
      .int()
      .min(1, { error: "At least 1 session a week." })
      .max(MAX_SESSIONS_PER_WEEK),
    maxSessions: z
      .number()
      .int()
      .min(1)
      .max(MAX_SESSIONS_PER_WEEK, { error: `${MAX_SESSIONS_PER_WEEK} sessions a week at most.` }),
    keyShare: z.number().int().min(0).max(100),
    /** Days a week the athlete is fine doing two sessions, of any sports. */
    doubleDays: z.number().int().min(0).max(7).default(0),
  })
  .refine((mix) => mix.maxSessions >= mix.minSessions, {
    error: "The busiest week can't have fewer sessions than the quietest.",
    path: ["maxSessions"],
  });

export type WeekMix = z.infer<typeof weekMixSchema>;

export const DEFAULT_WEEK_MIX: WeekMix = {
  minSessions: 4,
  maxSessions: 6,
  keyShare: 20,
  doubleDays: 0,
};

/** Key sessions come from the low end of the range: they are the sessions that always happen. */
export function keySessionCount(mix: WeekMix) {
  return Math.min(MAX_KEY_SESSIONS, Math.round((mix.minSessions * mix.keyShare) / 100));
}

/** Easy sessions fill the rest of the range. */
export function easySessionRange(mix: WeekMix) {
  const keys = keySessionCount(mix);
  return {
    min: Math.max(0, mix.minSessions - keys),
    max: Math.max(0, mix.maxSessions - keys),
  };
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

/** A single "sessions" count saved before ranges becomes a range of one. */
function normalizeWeekMix(raw: Record<string, unknown>) {
  const mix = raw.weekMix;
  if (!mix || typeof mix !== "object") return legacyWeekMix(raw);
  const stored = mix as Record<string, unknown>;
  if (typeof stored.sessions === "number" && stored.minSessions == null) {
    return {
      minSessions: stored.sessions,
      maxSessions: stored.sessions,
      keyShare: stored.keyShare,
    };
  }
  return mix;
}

/** Plans saved before the week mix: "Intervals and zones" keeps some key sessions. */
function legacyWeekMix(raw: Record<string, unknown>): WeekMix {
  if (Array.isArray(raw.keySessions)) {
    return { ...DEFAULT_WEEK_MIX, keyShare: Math.min(100, raw.keySessions.length * 20) };
  }
  if (raw.workoutStyle !== "structured" || raw.buildPace === "hold") {
    return { ...DEFAULT_WEEK_MIX, keyShare: 0 };
  }
  const fast = raw.buildPace === "fast" || raw.buildPace === "overreach";
  return { ...DEFAULT_WEEK_MIX, keyShare: fast ? 40 : 20 };
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
    label: "From my goals",
    hint: "VO2 sets the hours each week from your fitness and where your season is.",
  },
  {
    id: "manual",
    label: "Cap my hours",
    hint: "The same, but never more than the hours you have each week.",
  },
] as const;

export type TargetMode = (typeof TARGET_MODES)[number]["id"];

export const trainingPlanSchema = z.object({
  targetMode: z.enum(["auto", "manual"]).default("auto"),
  weekMix: weekMixSchema.default(DEFAULT_WEEK_MIX),
  /** The athlete's own sport for a key session, by session id (ids start with their week). */
  keySessionSports: z.record(z.string(), z.enum(["cycling", "running"])).default({}),
  targetWeeklyHours: z.number().min(0.5).max(30),
  preferredRestWeekday: z.number().int().min(0).max(6),
  timeZone: z.string().min(1),
});

export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

export const keySessionSportSchema = z.object({
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-/),
  /** Null goes back to VO2's suggestion. */
  sport: z.enum(["cycling", "running"]).nullable(),
});

/** Sets or clears one pick; picks from other weeks are dropped, their sessions are gone. */
export function withKeySessionSport(
  picks: TrainingPlan["keySessionSports"],
  { id, sport }: z.infer<typeof keySessionSportSchema>,
): TrainingPlan["keySessionSports"] {
  const week = id.slice(0, 10);
  const next = Object.fromEntries(
    Object.entries(picks).filter(([key]) => key.startsWith(week) && key !== id),
  );
  if (sport) next[id] = sport;
  return next;
}

/** Load per hour of mostly aerobic work, used until the athlete has history. */
export const DEFAULT_LOAD_PER_HOUR = 42;

function withPlanDefaults(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  return {
    ...raw,
    targetMode: raw.targetMode === "manual" ? "manual" : "auto",
    weekMix: normalizeWeekMix(raw),
  };
}

export function parseTrainingPlan(value: unknown): TrainingPlan | null {
  const parsed = trainingPlanSchema.safeParse(withPlanDefaults(value));
  return parsed.success ? parsed.data : null;
}

export function isTrainingPlanComplete(value: unknown): value is TrainingPlan {
  return parseTrainingPlan(value) != null;
}

/** Starting hours: the last 3 months' average, or 5 without history. */
export function suggestedTargetHours(avgWeeklyHours: number) {
  const base = avgWeeklyHours > 0.5 ? avgWeeklyHours : 5;
  return Math.round(base * 10) / 10;
}

/** Last-3-month average below this is not a usable baseline. */
const THIN_WEEKLY_HOURS = 0.2;

export function hasRecentWeeklyHours(avgHours: number) {
  return avgHours > THIN_WEEKLY_HOURS;
}

function daysBetweenKeys(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Average weekly hours over the last 3 months, or since the first activity when the history is
 * shorter. Counts the days directly rather than building the fitness series for the whole
 * history, which took most of a second on a phone for an athlete with years of activities.
 */
export function recentAverageWeeklyHours(loads: FitnessLoad[], timeZone: string, now = new Date()) {
  if (!loads.length) return 0;
  let firstMs = Infinity;
  for (const load of loads) firstMs = Math.min(firstMs, Date.parse(load.start));
  const firstDayMs = startOfDay(toZoned(new Date(firstMs), timeZone)).getTime();
  const windowStartMs = Math.max(firstDayMs, periodStartMs("3m", timeZone, now) ?? firstDayMs);
  const fromKey = dayKey(new Date(windowStartMs), timeZone);
  const toKey = dayKey(now, timeZone);
  if (fromKey > toKey) return 0;

  let movingSeconds = 0;
  for (const load of loads) {
    const key = dayKey(new Date(load.start), timeZone);
    if (key >= fromKey && key <= toKey) movingSeconds += load.movingTime;
  }
  const days = daysBetweenKeys(fromKey, toKey) + 1;
  return movingSeconds / (days / 7) / 3600;
}

export type SessionHistory = { average: number; low: number; high: number };

/** Activities a week over the last 3 months: the average and the usual low and high. */
export function recentSessionHistory(
  loads: FitnessLoad[],
  now = new Date(),
): SessionHistory | null {
  const weeks = 13;
  const counts = Array.from({ length: weeks }, () => 0);
  for (const load of loads) {
    const age = Math.floor((now.getTime() - new Date(load.start).getTime()) / (7 * 86_400_000));
    if (age >= 0 && age < weeks) counts[age] += 1;
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < 3) return null;
  const sorted = [...counts].sort((left, right) => left - right);
  // Skip the odd holiday or block week: the 20th and 80th percentile weeks.
  const at = (share: number) => sorted[Math.round((sorted.length - 1) * share)];
  return {
    average: total / weeks,
    low: Math.max(1, at(0.2)),
    high: Math.max(1, at(0.8)),
  };
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
