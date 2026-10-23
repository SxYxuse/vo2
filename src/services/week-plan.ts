import { z } from "zod";

import { sportGroupFor } from "./sport-groups.ts";
import {
  addDayKey,
  isKeySport,
  keySessionMinutes,
  type KeySession,
  type TrainingPlan,
} from "./training-plan.types.ts";
import {
  EASY_MIN_RIDE,
  EASY_MIN_RUN,
  OPENER,
  buildRecommendation,
  fitKeySession,
  goalsOn,
  isTodayComplete,
  type PartSport,
  type Recommendation,
  type WeekSummary,
  type WeekTargetData,
} from "./week-target.ts";

// The week coach (ADR 0024) has two halves. This file is the algorithm's: it lays the rest of
// the week out on days and checks any layout the model proposes against the same rules.

/** What the athlete can say about a day: no training, little time, indoors only, or go easy. */
export const CONSTRAINT_KINDS = [
  { id: "off", label: "Can't train" },
  { id: "short", label: "Short on time" },
  { id: "indoor", label: "Indoor only" },
  { id: "easy", label: "Take it easy" },
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number]["id"];

export const dayConstraintSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["off", "short", "indoor", "easy"]),
  /** Most minutes the athlete has that day, for "short". */
  minutes: z.number().int().min(10).max(600).nullable(),
});

export type DayConstraint = z.infer<typeof dayConstraintSchema>;

/** A note the athlete left for the coach, with the constraints read from it. */
export type CoachNote = {
  id: string;
  /** The day it is about. */
  date: string;
  text: string;
  constraints: DayConstraint[];
  /** False while free text waits for the model to read it. */
  parsed: boolean;
  createdAt: string;
};

export const PLAN_SPORTS = ["cycling", "running", "swimming", "walking", "strength"] as const;

export type PlannedDay = {
  date: string;
  kind: "rest" | "recovery" | "easy" | "key" | "race";
  sport: PartSport | null;
  minutes: number;
  /** A key session of this week, or "opener" the day before a race. */
  keySessionId: string | null;
  indoor: boolean;
  /** Why this day looks the way it does, for the athlete. */
  note: string | null;
};

export type WeekPlan = {
  days: PlannedDay[];
  /** The coach's short note on the week, or null from the algorithm alone. */
  note: string | null;
  source: "coach" | "algorithm";
  createdAt: string;
};

/** A short time cap for "short" without minutes. */
const SHORT_DEFAULT_MINUTES = 45;
/** A day the athlete is tired on stays this short. */
const EASY_DAY_MAX_MINUTES = 60;
const MAX_DAY_MINUTES = 360;

function weekdayOf(key: string) {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function round5(minutes: number) {
  return Math.max(0, Math.round(minutes / 5) * 5);
}

/** The constraints that apply to one day, merged: off wins, the tightest time cap holds. */
export function constraintsOn(constraints: DayConstraint[], date: string) {
  const day = constraints.filter((constraint) => constraint.date === date);
  const caps = day
    .filter((constraint) => constraint.kind === "short")
    .map((constraint) => constraint.minutes ?? SHORT_DEFAULT_MINUTES);
  return {
    off: day.some((constraint) => constraint.kind === "off"),
    cap: caps.length ? Math.min(...caps) : null,
    indoor: day.some((constraint) => constraint.kind === "indoor"),
    easy: day.some((constraint) => constraint.kind === "easy"),
  };
}

function isHardSession(session: KeySession) {
  return session.kind !== "long" && session.zone !== "z2";
}

/** Days from today (or tomorrow, once today has an activity) through Sunday. */
export function planDates(data: Pick<WeekTargetData, "today" | "weekStart" | "activities">) {
  const sunday = addDayKey(data.weekStart, 6);
  const dates: string[] = [];
  const first = isTodayComplete(data) ? addDayKey(data.today, 1) : data.today;
  for (let date = first; date <= sunday; date = addDayKey(date, 1)) dates.push(date);
  return dates;
}

function easySport(summary: WeekSummary, left: Record<"cycling" | "running", number>): PartSport {
  if (left.cycling <= 0 && left.running <= 0) {
    return summary.shares.running > summary.shares.cycling ? "running" : "cycling";
  }
  return left.running > left.cycling ? "running" : "cycling";
}

/**
 * The algorithm's layout of the rest of the week. Key sessions go on separate days, hard ones
 * never back to back, the long one on the day with the most time (weekends first); easy time
 * fills the other days in sessions of at least 45 min on a bike or 30 on foot; the athlete's
 * constraints and rest day hold; a goal's day is the race and the day before is an opener.
 */
export function planWeek(
  data: WeekTargetData & { plan: TrainingPlan },
  summary: WeekSummary,
  constraints: DayConstraint[],
  now = new Date(),
): WeekPlan {
  const dates = planDates(data);
  const days = new Map<string, PlannedDay>();
  const blank = (date: string): PlannedDay => ({
    date,
    kind: "rest",
    sport: null,
    minutes: 0,
    keySessionId: null,
    indoor: constraintsOn(constraints, date).indoor,
    note: null,
  });

  // Races, openers, the athlete's days off, and the rest day come first.
  const free: string[] = [];
  for (const date of dates) {
    const day = blank(date);
    const race = goalsOn(data, date);
    const raceTomorrow = goalsOn(data, addDayKey(date, 1)).filter((goal) => goal.priority !== "C");
    const limits = constraintsOn(constraints, date);
    if (race.length) {
      day.kind = "race";
      const sport = sportGroupFor(race[0]!.sportType)?.id;
      day.sport = sport && isKeySport(sport) ? sport : null;
      day.note = race.map((goal) => goal.name).join(" + ");
    } else if (limits.off) {
      day.note = "You can't train this day.";
    } else if (raceTomorrow.length) {
      const sport = sportGroupFor(raceTomorrow[0]!.sportType)?.id;
      day.kind = "key";
      day.sport = sport && isKeySport(sport) ? sport : "cycling";
      day.minutes = keySessionMinutes(OPENER);
      day.keySessionId = OPENER.id;
      day.note = "Opener: three short efforts the day before the race.";
    } else if (
      summary.restDayAhead &&
      dates.length > 1 &&
      weekdayOf(date) === data.plan.preferredRestWeekday
    ) {
      day.note = "Your rest day.";
    } else {
      free.push(date);
    }
    days.set(date, day);
  }

  const capOf = (date: string) => {
    const limits = constraintsOn(constraints, date);
    if (limits.easy) return Math.min(limits.cap ?? EASY_DAY_MAX_MINUTES, EASY_DAY_MAX_MINUTES);
    return limits.cap ?? MAX_DAY_MINUTES;
  };
  const hardDates = new Set<string>();
  const hardYesterday = data.activities.some(
    (activity) =>
      activity.date === addDayKey(dates[0] ?? data.today, -1) && activity.hardMinutes >= 15,
  );
  if (hardYesterday && dates[0]) hardDates.add(addDayKey(dates[0], -1));
  const nextToHard = (date: string) =>
    hardDates.has(addDayKey(date, -1)) || hardDates.has(addDayKey(date, 1));

  // Key sessions: hardest first so they get the best-spaced days, the long one last on the
  // day with the most room.
  const open = summary.paused
    ? []
    : summary.keySessions
        .filter((status) => !status.done && !status.skipped)
        .sort(
          (left, right) =>
            Number(left.session.kind === "long") - Number(right.session.kind === "long"),
        );
  const keyDates = new Set<string>();
  let keyRoom = summary.remainingMinutes;
  for (const status of open) {
    const session = status.session;
    const hard = isHardSession(session);
    const candidates = free.filter(
      (date) =>
        !keyDates.has(date) &&
        !constraintsOn(constraints, date).easy &&
        capOf(date) >= 45 &&
        !(hard && nextToHard(date)),
    );
    if (!candidates.length) continue;
    // Intervals that no longer fit the time left wait for next week rather than overfill this one.
    if (session.kind !== "long" && keySessionMinutes(session) > keyRoom + 15) continue;
    const pick =
      session.kind === "long"
        ? [...candidates].sort((left, right) => {
            const weekend = (date: string) => Number([0, 6].includes(weekdayOf(date)));
            return capOf(right) - capOf(left) || weekend(right) - weekend(left);
          })[0]!
        : candidates[0]!;
    // The long session takes what the week has left, never less than a worthwhile ride.
    const room = session.kind === "long" ? Math.max(45, keyRoom) : capOf(pick);
    const fitted = fitKeySession(session, Math.min(capOf(pick), room));
    keyRoom -= keySessionMinutes(fitted);
    const day = days.get(pick)!;
    day.kind = "key";
    day.sport = session.sport === "any" ? "cycling" : session.sport;
    day.minutes = keySessionMinutes(fitted);
    day.keySessionId = session.id;
    keyDates.add(pick);
    if (hard) hardDates.add(pick);
  }

  // Easy time over the remaining free days, never shorter than a worthwhile session.
  const keyMinutes = [...days.values()].reduce(
    (sum, day) => sum + (day.kind === "key" ? day.minutes : 0),
    0,
  );
  let easyLeft = Math.max(0, summary.remainingMinutes - keyMinutes);
  const left = {
    cycling: summary.bySport.cycling.left,
    running: summary.bySport.running.left,
  };
  const easyDates = free.filter((date) => !keyDates.has(date));
  const sessions = Math.max(0, summary.easy.planned - summary.easy.done);
  const chosen = easyDates.slice(0, Math.max(sessions, 0));
  chosen.forEach((date, index) => {
    if (easyLeft <= 0) return;
    const day = days.get(date)!;
    const limits = constraintsOn(constraints, date);
    const sport = easySport(summary, left);
    const floor = sport === "cycling" ? EASY_MIN_RIDE : EASY_MIN_RUN;
    const share = easyLeft / (chosen.length - index);
    const minutes = Math.min(capOf(date), Math.max(floor, round5(share)));
    day.kind = limits.easy && summary.form < -10 ? "recovery" : "easy";
    day.sport = sport;
    day.minutes = round5(Math.min(minutes, easyLeft + 15));
    easyLeft -= day.minutes;
    if (sport === "cycling" || sport === "running") left[sport] -= day.minutes;
    if (limits.easy) day.note = "Easy, as you asked.";
    else if (limits.cap != null) day.note = `Fits the ${limits.cap} min you have.`;
  });

  return {
    days: dates.map((date) => days.get(date)!),
    note: null,
    source: "algorithm",
    createdAt: now.toISOString(),
  };
}

/**
 * Today's session from the day plan, so the Today card and the plan agree until the athlete
 * says otherwise. Race days keep the race-day pick.
 */
export function planRecommendation(
  data: WeekTargetData & { plan: TrainingPlan },
  summary: WeekSummary,
  planned: PlannedDay,
): Recommendation | null {
  const reason = planned.note ?? "From your day plan.";
  if (planned.kind === "race") return null;
  if (planned.kind === "rest") {
    return buildRecommendation(
      { kind: "rest", keySession: null, parts: [], reasons: [reason] },
      data,
      summary,
    );
  }
  if (!planned.sport || planned.minutes <= 0) return null;
  if (planned.kind === "key") {
    const status = summary.keySessions.find((item) => item.session.id === planned.keySessionId);
    const session = planned.keySessionId === OPENER.id ? OPENER : status?.session;
    if (!session) return null;
    const fitted = fitKeySession(
      { ...session, sport: isKeySport(planned.sport) ? planned.sport : session.sport },
      planned.minutes,
    );
    return buildRecommendation(
      {
        kind: "key",
        keySession: fitted,
        parts: [{ sport: planned.sport, minutes: keySessionMinutes(fitted), main: true }],
        reasons: [reason],
      },
      data,
      summary,
    );
  }
  return buildRecommendation(
    {
      kind: planned.kind,
      keySession: null,
      parts: [{ sport: planned.sport, minutes: planned.minutes, main: true }],
      reasons: [reason],
    },
    data,
    summary,
  );
}

/** What a proposed layout must respect: the algorithm's rules and the athlete's words. */
export type PlanRules = {
  base: WeekPlan;
  constraints: DayConstraint[];
  openKeys: Map<string, KeySession>;
  remainingMinutes: number;
  hardBefore: boolean;
};

export const proposedPlanSchema = z.object({
  constraints: z.array(dayConstraintSchema).max(14),
  days: z
    .array(
      z.object({
        date: z.string(),
        kind: z.enum(["rest", "recovery", "easy", "key"]),
        sport: z.enum(PLAN_SPORTS).nullable(),
        minutes: z.number().int().min(0).max(MAX_DAY_MINUTES),
        keySessionId: z.string().nullable(),
        indoor: z.boolean(),
        note: z.string().max(200).nullable(),
      }),
    )
    .max(7),
  note: z.string().min(1).max(500),
});

export type ProposedPlan = z.infer<typeof proposedPlanSchema>;

/** Constraints the model read from the athlete's words, kept only for days of this plan. */
export function acceptConstraints(raw: DayConstraint[], dates: string[]) {
  const allowed = new Set(dates);
  return raw.filter((constraint) => allowed.has(constraint.date));
}

/**
 * The model's layout if it keeps every rule, else null so the algorithm's stands. Races and
 * openers stay where the algorithm put them; small time overruns are trimmed, not rejected.
 */
export function acceptProposedPlan(
  raw: ProposedPlan,
  rules: PlanRules,
  now = new Date(),
): { plan: WeekPlan | null; problems: string[] } {
  const problems: string[] = [];
  const byDate = new Map(raw.days.map((day) => [day.date, day]));
  if (byDate.size !== raw.days.length) problems.push("a date appears twice");
  for (const date of byDate.keys()) {
    if (!rules.base.days.some((day) => day.date === date)) problems.push(`unknown date ${date}`);
  }
  const usedKeys = new Set<string>();
  const hardDates = new Set<string>();
  const days: PlannedDay[] = rules.base.days.map((base) => {
    // The algorithm owns races and openers.
    if (base.kind === "race" || base.keySessionId === OPENER.id) return base;
    const proposed = byDate.get(base.date);
    if (!proposed) return base;
    const limits = constraintsOn(rules.constraints, base.date);
    const day: PlannedDay = {
      date: base.date,
      kind: proposed.kind,
      sport: proposed.kind === "rest" ? null : proposed.sport,
      minutes: proposed.kind === "rest" ? 0 : round5(proposed.minutes),
      keySessionId: proposed.kind === "key" ? proposed.keySessionId : null,
      indoor: proposed.indoor || limits.indoor,
      note: proposed.note,
    };
    if (limits.off && day.kind !== "rest") problems.push(`${day.date} is a day off`);
    if (limits.easy && day.kind === "key") problems.push(`${day.date} should be easy`);
    if (limits.cap != null && day.minutes > limits.cap + 5) {
      problems.push(`${day.date} is longer than the ${limits.cap} min the athlete has`);
    }
    if (day.kind !== "rest" && (day.sport == null || day.minutes <= 0)) {
      problems.push(`${day.date} has no sport or time`);
    }
    if (day.kind === "key") {
      const session = day.keySessionId ? rules.openKeys.get(day.keySessionId) : undefined;
      if (!session) problems.push(`${day.date} has an unknown key session`);
      else if (usedKeys.has(session.id)) problems.push(`${session.id} is planned twice`);
      else {
        usedKeys.add(session.id);
        if (!day.sport || !isKeySport(day.sport)) problems.push(`${day.date} key session sport`);
        if (isHardSession(session)) hardDates.add(day.date);
      }
    }
    return day;
  });
  const firstDate = days[0]?.date;
  for (const date of hardDates) {
    const before = addDayKey(date, -1);
    if (
      hardDates.has(before) ||
      (rules.hardBefore && before === addDayKey(firstDate ?? date, -1))
    ) {
      problems.push(`hard days back to back around ${date}`);
    }
  }
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  const baseTotal = rules.base.days.reduce((sum, day) => sum + day.minutes, 0);
  const ceiling = Math.max(rules.remainingMinutes, baseTotal) * 1.1 + 15;
  if (total > ceiling) problems.push("more time than the week has left");
  // Leaving days empty that the athlete can train on, while the week still needs time, is not
  // a plan: keep at least most of what the algorithm found room for.
  const needed = Math.min(rules.remainingMinutes, baseTotal);
  if (needed >= 30 && total < needed * 0.6) problems.push("leaves most of the week's time unused");
  if (problems.length) return { plan: null, problems };
  return {
    plan: { days, note: raw.note, source: "coach", createdAt: now.toISOString() },
    problems,
  };
}

/** The coach's side of the week page: the athlete's notes and the plan made from them. */
export type WeekCoachState = {
  weekStart: string;
  notes: CoachNote[];
  plan: WeekPlan | null;
  /** The plan predates a sync or a note; asking the coach again brings it up to date. */
  stale: boolean;
  /** False without a model: quick choices still work, free text waits. */
  aiAvailable: boolean;
};

export const coachNoteInputSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["off", "short", "indoor", "easy"]).nullable(),
    minutes: z.number().int().min(10).max(600).nullable(),
    text: z.string().trim().max(500),
  })
  .refine((note) => note.kind != null || note.text.length > 0, {
    error: "Pick a choice or write a note.",
    path: ["text"],
  });

export type CoachNoteInput = z.infer<typeof coachNoteInputSchema>;

/** A note from the athlete's input: a quick choice is read at once, free text by the model. */
export function noteFrom(input: CoachNoteInput, id: string, now = new Date()): CoachNote {
  const label = CONSTRAINT_KINDS.find((kind) => kind.id === input.kind)?.label;
  return {
    id,
    date: input.date,
    text: input.text || (label ? `${label}${input.minutes ? ` (${input.minutes} min)` : ""}` : ""),
    constraints: input.kind
      ? [
          {
            date: input.date,
            kind: input.kind,
            minutes: input.kind === "short" ? input.minutes : null,
          },
        ]
      : [],
    parsed: input.kind != null && !input.text,
    createdAt: now.toISOString(),
  };
}

/**
 * Hands constraints the model read to the notes still waiting: by date, the rest to the latest.
 * Constraints a note already has are not repeated.
 */
export function withParsedConstraints(notes: CoachNote[], read: DayConstraint[]): CoachNote[] {
  const known = new Set(
    notes.flatMap((note) => note.constraints).map((item) => `${item.date}:${item.kind}`),
  );
  const fresh = read.filter((item) => !known.has(`${item.date}:${item.kind}`));
  const waiting = notes.filter((note) => !note.parsed);
  if (!waiting.length) return notes;
  const latest = waiting.at(-1)!;
  return notes.map((note) => {
    if (note.parsed) return note;
    const own = fresh.filter(
      (item) =>
        item.date === note.date ||
        (note === latest && !waiting.some((other) => other.date === item.date)),
    );
    return { ...note, constraints: [...note.constraints, ...own], parsed: true };
  });
}
