import { TZDate } from "@date-fns/tz";
import { startOfDay } from "date-fns";
import { z } from "zod";

import type { ZoneAnchors } from "./heart-rate.ts";
import { sportGroupFor } from "./sport-groups.ts";
import { dayKey } from "./day-key.ts";
import { buildPmc, periodStartMs, type FitnessLoad } from "./training-load.ts";

export { addDayKey, dayKey, weekStartKey } from "./day-key.ts";

/** Which key session types lead a week; the season phase picks one (ADR 0021). */
export type BuildPace = "hold" | "slow" | "steady" | "fast" | "overreach";

/** Sports a key session can go on: the sport groups with heart-rate zones (ADR 0021). */
export const KEY_SPORTS = ["cycling", "running", "swimming", "walking"] as const;
export type KeySport = (typeof KEY_SPORTS)[number];

export function isKeySport(value: string): value is KeySport {
  return (KEY_SPORTS as readonly string[]).includes(value);
}

export const HR_TARGET_ZONES = ["z2", "z3", "z4", "z5"] as const;
export type TargetZone = (typeof HR_TARGET_ZONES)[number];

export const keySessionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["intervals", "zone", "long"]),
  sport: z.enum([...KEY_SPORTS, "any"]),
  reps: z
    .number()
    .int()
    .min(1, { error: "At least 1 rep." })
    .max(20, { error: "20 reps at most." }),
  workMinutes: z
    .number()
    .min(1, { error: "At least 1 minute." })
    .max(360, { error: "6 hours at most." }),
  zone: z.enum(HR_TARGET_ZONES),
  restMinutes: z.number().min(0).max(30, { error: "30 minutes at most." }),
});

export type KeySession = z.infer<typeof keySessionSchema>;
export type KeySessionKind = KeySession["kind"];

/** Generated key sessions are capped here whatever the objective asks. */
export const MAX_KEY_SESSIONS = 4;

/** Key sessions a week by the leading goal's objective (ADR 0026); one while holding fitness. */
const KEY_SESSIONS_BY_OBJECTIVE = { finish: 1, finishWell: 2, perform: 3 } as const;

/**
 * This week's key sessions: the objective's count, within the phase's own limit and half the
 * training days, so hard days never have to sit back to back.
 */
export function keySessionCountFor(input: {
  objective: keyof typeof KEY_SESSIONS_BY_OBJECTIVE | null;
  phaseMax: number | null;
  trainingDays: number;
}) {
  const wanted = input.objective ? KEY_SESSIONS_BY_OBJECTIVE[input.objective] : 1;
  return Math.max(
    0,
    Math.min(
      wanted,
      input.phaseMax ?? MAX_KEY_SESSIONS,
      Math.floor(input.trainingDays / 2),
      MAX_KEY_SESSIONS,
    ),
  );
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

export type FamilyCollectors = {
  heartRate: boolean;
  power: boolean;
  powerPartial: boolean;
};

export type PlanningAnchors = {
  ftpWatts: number | null;
  /** Each sport's zone anchors and method, so session cues match the athlete's zones. */
  heartRate: Record<KeySport, ZoneAnchors>;
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

/** Sports the plan can put sessions on: those with heart-rate zones. */
export const PLAN_SPORTS = KEY_SPORTS;
export type PlanSport = KeySport;

export const MIN_REST_DAYS = 1;
export const MAX_REST_DAYS = 4;
export const MAX_DOUBLE_DAYS = 4;
/** Easy time per training day while VO2 has no history to set the week from. */
export const NO_HISTORY_MINUTES_PER_DAY = 45;

const weekdaySchema = z.number().int().min(0).max(6);
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A goal as the plan was built or last adapted on (ADR 0026). */
export const planGoalSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  sportType: z.string(),
  date: dateKeySchema,
  distanceM: z.number().nullable(),
  elevationGainM: z.number().nullable(),
  objective: z.enum(["finish", "finishWell", "perform"]),
  priority: z.enum(["A", "B", "C"]),
});

export type PlanGoal = z.infer<typeof planGoalSchema>;

/** The week's shape: what the athlete chooses in the plan builder and Settings → Training. */
export const weekShapeFields = {
  restWeekdays: z
    .array(weekdaySchema)
    .min(MIN_REST_DAYS, { error: "Pick at least one rest day." })
    .max(MAX_REST_DAYS, { error: "Leave at least three days to train." }),
  longWeekday: weekdaySchema,
  doubleDays: z.number().int().min(0).max(MAX_DOUBLE_DAYS),
  sports: z.array(z.enum(PLAN_SPORTS)).min(1, { error: "Pick at least one sport." }),
};

export const WEEK_SHAPE_KEYS = ["restWeekdays", "longWeekday", "doubleDays", "sports"] as const;

export type WeekShape = {
  restWeekdays: number[];
  longWeekday: number;
  doubleDays: number;
  sports: PlanSport[];
};

/** Problems with a week shape that its fields alone cannot catch. */
export function weekShapeIssues(shape: WeekShape) {
  const issues: { path: keyof WeekShape; message: string }[] = [];
  if (new Set(shape.restWeekdays).size !== shape.restWeekdays.length) {
    issues.push({ path: "restWeekdays", message: "A day is listed twice." });
  }
  if (shape.restWeekdays.includes(shape.longWeekday)) {
    issues.push({ path: "longWeekday", message: "Pick a training day for the long session." });
  }
  if (shape.doubleDays > trainingDayCount(shape)) {
    issues.push({ path: "doubleDays", message: "More double-session days than training days." });
  }
  return issues;
}

export function withWeekShapeIssues<T extends z.ZodType<WeekShape>>(schema: T) {
  return schema.superRefine((value, ctx) => {
    for (const issue of weekShapeIssues(value)) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  });
}

export const trainingPlanFields = {
  ...weekShapeFields,
  /** The goals the plan was built on; null for a plan saved before the plan builder. */
  goals: z.array(planGoalSchema).nullable().default(null),
  /** Monday of the week the plan was built. */
  startWeek: dateKeySchema.nullable().default(null),
  /** Weekly minutes to grow from after a break, instead of what history says. */
  baselineMinutes: z.number().int().min(30).max(1800).nullable().default(null),
  /** The athlete's own sport for a key session, by session id (ids start with their week). */
  keySessionSports: z.record(z.string(), z.enum(KEY_SPORTS)).default({}),
  timeZone: z.string().min(1),
};

export const trainingPlanSchema = withWeekShapeIssues(z.object(trainingPlanFields));

export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

export function trainingDayCount(shape: Pick<WeekShape, "restWeekdays">) {
  return 7 - new Set(shape.restWeekdays).size;
}

export function isRestWeekday(shape: Pick<WeekShape, "restWeekdays">, weekday: number) {
  return shape.restWeekdays.includes(weekday);
}

/**
 * A shape the athlete just edited, made whole: the long session moves off a new rest day to the
 * closest training day, and double-session days never outnumber training days.
 */
export function normalizeShape<T extends WeekShape>(shape: T): T {
  const restWeekdays = [...new Set(shape.restWeekdays)].sort((a, b) => a - b);
  let { longWeekday } = shape;
  if (restWeekdays.includes(longWeekday)) {
    const near = [0, 1, -1, 2, -2, 3, -3]
      .map((offset) => (longWeekday + offset + 7) % 7)
      .find((weekday) => !restWeekdays.includes(weekday));
    longWeekday = near ?? defaultLongWeekday(restWeekdays);
  }
  const doubleDays = Math.min(shape.doubleDays, 7 - restWeekdays.length);
  return { ...shape, restWeekdays, longWeekday, doubleDays };
}

/** The training day closest to Saturday, Sunday first on a tie: where a long session fits best. */
export function defaultLongWeekday(restWeekdays: number[]) {
  for (const weekday of [6, 0, 5, 4, 3, 2, 1]) {
    if (!restWeekdays.includes(weekday)) return weekday;
  }
  return 6;
}

export const keySessionSportSchema = z.object({
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-/),
  /** Null goes back to VO2's suggestion. */
  sport: z.enum(KEY_SPORTS).nullable(),
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

/**
 * Plans saved before the plan builder had one preferred rest day, a week mix, and hours: they
 * keep the rest day and double days, plan rides and runs, and follow the season directly.
 */
function withPlanDefaults(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  if (Array.isArray(raw.restWeekdays)) return raw;
  const rest = typeof raw.preferredRestWeekday === "number" ? raw.preferredRestWeekday : 1;
  const restWeekdays = [rest];
  const mix = raw.weekMix as { doubleDays?: unknown } | undefined;
  const doubleDays = typeof mix?.doubleDays === "number" ? mix.doubleDays : 0;
  return {
    restWeekdays,
    longWeekday: defaultLongWeekday(restWeekdays),
    doubleDays: Math.min(MAX_DOUBLE_DAYS, doubleDays),
    sports: ["cycling", "running"],
    goals: null,
    startWeek: null,
    baselineMinutes: null,
    keySessionSports: raw.keySessionSports ?? {},
    timeZone: raw.timeZone,
  };
}

export function parseTrainingPlan(value: unknown): TrainingPlan | null {
  const parsed = trainingPlanSchema.safeParse(withPlanDefaults(value));
  return parsed.success ? parsed.data : null;
}

export function isTrainingPlanComplete(value: unknown): value is TrainingPlan {
  return parseTrainingPlan(value) != null;
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

export function latestPmc(loads: FitnessLoad[], timeZone: string) {
  const pmc = buildPmc(loads, timeZone);
  return pmc.at(-1) ?? { ctl: 0, atl: 0, tsb: 0, date: dayKey(new Date(), timeZone) };
}
