import { z } from "zod";

import type { PlanImpact } from "./plan-impact.ts";
import {
  goalDay,
  goalSessions,
  projectSeason,
  weekLoadsBefore,
  type GroupPace,
  type SeasonPhase,
} from "./season-phase.ts";
import { roughGoalHours, type Goal } from "./season.types.ts";
import { isOtherSportType, sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import { ATL_DAYS, CTL_DAYS, formLabel } from "./training-load.ts";
import {
  addDayKey,
  isKeySport,
  isRestWeekday,
  keySessionMinutes,
  keySessionName,
  type KeySession,
  type KeySport,
  type SportFamily,
  type TrainingPlan,
} from "./training-plan.types.ts";
import {
  EASY_MIN_RIDE,
  EASY_MIN_RUN,
  EASY_SESSION_MIN_MINUTES,
  HARD_DAY_MINUTES,
  OPENER,
  buildRecommendation,
  fitKeySession,
  isTodayComplete,
  summarizeWeek,
  type Recommendation,
  type WeekActivity,
  type WeekProjection,
  type WeekSummary,
  type WeekTargetData,
} from "./week-target.ts";

// The week plan (ADR 0026): the training week laid out Monday to Sunday the first time it is
// opened, with the days after today laid out again when something changes them. This file is
// the algorithm; the coach only reads the athlete's words into day constraints.

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

/** A race's sport when it is not a ride, run, swim, or walk. */
export type SessionSport = KeySport | "other";

export type PlannedSession = {
  /** Unique within the week: the date and the session's place on it. */
  id: string;
  kind: "key" | "easy" | "recovery" | "opener" | "race";
  sport: SessionSport;
  minutes: number;
  /** The key session this is, or "opener". */
  keySessionId: string | null;
  /** The goals raced, for a race. */
  goalIds: string[];
  /** The second session of a double-session day. */
  second: boolean;
  /** Why this session looks the way it does, for the athlete. */
  note: string | null;
};

export type PlannedDay = {
  date: string;
  /** One of the athlete's rest days, or a day they can't train. */
  rest: boolean;
  /** A day of this week before the week was first planned: nothing was planned on it. */
  beforePlan: boolean;
  indoor: boolean;
  sessions: PlannedSession[];
  note: string | null;
};

export const WEEK_PLAN_VERSION = 2;

export type WeekPlan = {
  version: typeof WEEK_PLAN_VERSION;
  weekStart: string;
  /** Monday to Sunday. */
  days: PlannedDay[];
  /** Key sessions that did not fit this week. */
  dropped: string[];
  /** The coach's short note on the week, or null without one. */
  note: string | null;
  createdAt: string;
};

/** A stored plan for this week in the current shape; older shapes are planned again. */
export function isWeekPlan(value: unknown, weekStart: string): value is WeekPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<WeekPlan>;
  return (
    plan.version === WEEK_PLAN_VERSION &&
    plan.weekStart === weekStart &&
    Array.isArray(plan.days) &&
    plan.days.length === 7
  );
}

/** A short time cap for "short" without minutes. */
const SHORT_DEFAULT_MINUTES = 45;
/** An easy day (asked for, or around a goal) stays this short. */
const EASY_DAY_MAX_MINUTES = 60;
const MAX_DAY_MINUTES = 360;
/** Longest easy session per sport: beyond it the time goes to a second session or is left. */
const EASY_MAX_MINUTES: Record<KeySport, number> = {
  cycling: 180,
  running: 90,
  swimming: 60,
  walking: 120,
};
const EASY_MIN_MINUTES: Record<KeySport, number> = {
  cycling: EASY_MIN_RIDE,
  running: EASY_MIN_RUN,
  swimming: 30,
  walking: 30,
};
/** A second session is short: it adds easy time, it is not a second workout. */
const SECOND_MAX_MINUTES = 60;
const SECOND_MIN_MINUTES = 30;
/** A sport this far below its share gets a second session even when the time fits singles. */
const SPORT_COVER_MIN_MINUTES = 30;

function weekdayOf(key: string) {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function daysApart(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
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

/** The first day to plan: today, or tomorrow once today has an activity. */
export function firstPlanDate(data: Pick<WeekTargetData, "today" | "weekStart" | "activities">) {
  const first = isTodayComplete(data) ? addDayKey(data.today, 1) : data.today;
  return first < data.weekStart ? data.weekStart : first;
}

/** The dates of the training week, Monday first. */
export function weekDates(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addDayKey(weekStart, index));
}

function goalSport(goal: Goal): SessionSport {
  const group = sportGroupFor(goal.sportType)?.id;
  return group && isKeySport(group) ? group : "other";
}

function eventName(goals: Goal[]) {
  return [...new Set(goals.map((goal) => goal.name.split(" · ")[0]!))].join(" + ");
}

/** Time a race takes from the week, roughly; the race itself is not a planned workout. */
function raceMinutes(goal: Goal) {
  return round5(roughGoalHours(goal) * 60);
}

const FAMILY_OF: Record<KeySport, SportFamily> = {
  cycling: "cycling",
  running: "running",
  swimming: "other",
  walking: "other",
};

/** The planned sport with the most time left, among those the athlete plans. */
function easySport(
  sports: readonly KeySport[],
  left: Record<SportFamily, number>,
  shares: Record<SportFamily, number>,
): KeySport {
  const ranked = [...sports].sort(
    (a, b) =>
      left[FAMILY_OF[b]] - left[FAMILY_OF[a]] || shares[FAMILY_OF[b]] - shares[FAMILY_OF[a]],
  );
  return ranked[0] ?? "cycling";
}

/**
 * Lays the week out: the days before `firstPlanDate` keep what the previous plan had, and the
 * rest are planned from what is left of the week target.
 *
 * Races, openers, rest days, and the athlete's days off come first. Key sessions follow: the
 * long one on the long session day (or the nearest training day), the hard ones spread apart
 * and never next to another hard day. A B or C race on the long session's sport stands in for
 * the long session. Easy time fills the free training days in sessions of at least 45 min on a
 * bike or 30 on foot; what does not fit, or a planned sport with no time yet, goes to second
 * sessions on up to the athlete's double-session days.
 */
export function planWeek(input: {
  data: WeekTargetData & { plan: TrainingPlan };
  summary: WeekSummary;
  constraints: DayConstraint[];
  previous: WeekPlan | null;
  now?: Date;
}): WeekPlan {
  const { data, summary, constraints, previous } = input;
  const { plan } = data;
  const from = firstPlanDate(data);
  const dates = weekDates(data.weekStart);
  const anchorIds = new Set(data.season.anchor.map((goal) => goal.id));
  const previousDay = (date: string) =>
    previous && isWeekPlan(previous, data.weekStart)
      ? previous.days.find((day) => day.date === date)
      : undefined;

  const days = new Map<string, PlannedDay>();
  const caps = new Map<string, number>();
  const easyOnly = new Map<string, string>();
  const open: string[] = [];
  let reserved = 0;

  const session = (
    date: string,
    fields: Omit<PlannedSession, "id" | "goalIds" | "second" | "note" | "keySessionId"> &
      Partial<PlannedSession>,
  ): PlannedSession => ({
    id: `${date}:${days.get(date)?.sessions.length ?? 0}`,
    keySessionId: null,
    goalIds: [],
    second: false,
    note: null,
    ...fields,
  });

  // Races, openers, rest and days off; days already behind keep what was planned.
  for (const date of dates) {
    const restDay = isRestWeekday(plan, weekdayOf(date));
    if (date < from) {
      days.set(
        date,
        previousDay(date) ?? {
          date,
          rest: restDay,
          beforePlan: true,
          indoor: false,
          sessions: [],
          note: null,
        },
      );
      continue;
    }
    const limits = constraintsOn(constraints, date);
    const around = goalDay(data.nearbyGoals, date);
    const day: PlannedDay = {
      date,
      rest: false,
      beforePlan: false,
      indoor: limits.indoor,
      sessions: [],
      note: null,
    };
    days.set(date, day);
    if (around.race.length) {
      day.note = eventName(around.race);
      for (const goal of around.race) {
        const minutes = raceMinutes(goal);
        // An A race's week is already cut back by its phase; B and C races are part of it.
        if (!anchorIds.has(goal.id) || goal.priority !== "A") reserved += minutes;
        day.sessions.push(
          session(date, {
            kind: "race",
            sport: goalSport(goal),
            minutes,
            goalIds: [goal.id],
            note:
              goal.priority === "C"
                ? "A C race: race it as a hard session, no need to hold back."
                : null,
          }),
        );
      }
      continue;
    }
    if (limits.off) {
      day.rest = true;
      day.note = "You can't train this day.";
      continue;
    }
    if (restDay) {
      day.rest = true;
      continue;
    }
    const cap = limits.cap ?? MAX_DAY_MINUTES;
    caps.set(date, cap);
    if (around.opener) {
      const sport = goalSport(around.opener);
      const minutes = keySessionMinutes(OPENER);
      reserved += minutes;
      day.sessions.push(
        session(date, {
          kind: "opener",
          sport: sport === "other" ? "cycling" : sport,
          minutes,
          keySessionId: OPENER.id,
          note: `Three short efforts the day before ${eventName([around.opener])}: they wake the legs without tiring them.`,
        }),
      );
      continue;
    }
    if (around.easy) {
      const after = around.easy.date < date;
      easyOnly.set(date, `${after ? "Easy after" : "Easy before"} ${eventName([around.easy])}.`);
    }
    if (limits.easy) easyOnly.set(date, "Easy, as you asked.");
    open.push(date);
  }

  const capOf = (date: string) =>
    easyOnly.has(date)
      ? Math.min(caps.get(date) ?? MAX_DAY_MINUTES, EASY_DAY_MAX_MINUTES)
      : (caps.get(date) ?? MAX_DAY_MINUTES);

  // Hard days: hard activities already done, races, and hard key sessions as they are placed.
  const hardDates = new Set<string>();
  for (const activity of data.activities) {
    if (activity.hardMinutes >= HARD_DAY_MINUTES) hardDates.add(activity.date);
  }
  for (const goal of data.nearbyGoals) hardDates.add(goal.date);
  const nextToHard = (date: string) =>
    hardDates.has(addDayKey(date, -1)) || hardDates.has(addDayKey(date, 1));

  // Key sessions still open this week, with their sport; a B or C race on the long
  // session's sport stands in for it.
  const races = [...days.values()].flatMap((day) =>
    day.sessions.filter((item) => item.kind === "race"),
  );
  const keys = summary.paused
    ? []
    : summary.keySessions
        .filter((status) => !status.done)
        .map((status) => status.session)
        .map((item) => ({
          ...item,
          sport: (item.sport === "any" ? "cycling" : item.sport) as KeySport,
        }));
  const long = keys.find((item) => item.kind === "long") ?? null;
  const raceForLong =
    long &&
    races.find(
      (race) => race.sport === long.sport && race.goalIds.every((id) => !anchorIds.has(id)),
    );
  if (raceForLong) raceForLong.note = "Counts as this week's long session.";
  const hard = keys.filter((item) => item.kind !== "long");

  const keyDates = new Map<string, KeySession>();
  const dropped: string[] = [];
  const keyCandidates = () =>
    open.filter((date) => !keyDates.has(date) && !easyOnly.has(date) && capOf(date) >= 45);

  // The long session goes on the long session day, or the closest training day to it.
  if (long && !raceForLong) {
    const target = addDayKey(data.weekStart, (plan.longWeekday + 6) % 7);
    const pick = keyCandidates().sort(
      (a, b) => Math.abs(daysApart(target, a)) - Math.abs(daysApart(target, b)) || (a < b ? 1 : -1),
    )[0];
    if (pick) keyDates.set(pick, long);
    else dropped.push(long.id);
  }

  // Hard sessions: as far from the other key sessions as the week allows, never next to a hard
  // day, and only while the week still has room for them.
  let keyRoom = Math.max(0, summary.remainingMinutes - reserved);
  for (const item of hard) {
    const minutes = keySessionMinutes(item);
    const candidates = keyCandidates().filter((date) => !nextToHard(date) && !hardDates.has(date));
    if (!candidates.length || minutes > keyRoom + 15) {
      dropped.push(item.id);
      continue;
    }
    const spacing = (date: string) =>
      Math.min(99, ...[...keyDates.keys()].map((other) => Math.abs(daysApart(other, date))));
    const pick = [...candidates].sort((a, b) => spacing(b) - spacing(a) || (a < b ? -1 : 1))[0]!;
    keyDates.set(pick, item);
    hardDates.add(pick);
    keyRoom -= Math.min(minutes, capOf(pick));
  }

  // Size and place them: intervals fit their day, the long one takes what the week has left.
  for (const [date, item] of [...keyDates].sort(([a], [b]) => a.localeCompare(b))) {
    const room = item.kind === "long" ? Math.min(capOf(date), Math.max(45, keyRoom)) : capOf(date);
    const fitted = fitKeySession(item, room);
    days.get(date)!.sessions.push(
      session(date, {
        kind: "key",
        sport: item.sport === "any" ? "cycling" : item.sport,
        minutes: keySessionMinutes(fitted),
        keySessionId: item.id,
      }),
    );
  }
  const keyMinutes = [...keyDates.keys()].reduce(
    (sum, date) =>
      sum +
      days
        .get(date)!
        .sessions.filter((item) => item.kind === "key")
        .reduce((total, item) => total + item.minutes, 0),
    0,
  );

  // Easy time over the free training days, never shorter than a worthwhile session.
  let easyLeft = Math.max(0, summary.remainingMinutes - reserved - keyMinutes);
  const left: Record<SportFamily, number> = {
    cycling: summary.bySport.cycling.left,
    running: summary.bySport.running.left,
    other: summary.bySport.other.left,
  };
  const free = open.filter((date) => !keyDates.has(date));
  const mainSport = easySport(plan.sports, left, summary.shares);
  const fits = Math.floor(easyLeft / EASY_MIN_MINUTES[mainSport]);
  const count = Math.min(free.length, fits);
  // With fewer sessions than free days, the days before a key session stay empty first.
  const beforeKey = (date: string) => keyDates.has(addDayKey(date, 1));
  const chosen = [...free]
    .sort((a, b) => Number(beforeKey(a)) - Number(beforeKey(b)) || a.localeCompare(b))
    .slice(0, count)
    .sort();
  chosen.forEach((date, index) => {
    if (easyLeft <= 0) return;
    const sport = easySport(plan.sports, left, summary.shares);
    const limits = constraintsOn(constraints, date);
    const ceiling = Math.min(capOf(date), EASY_MAX_MINUTES[sport]);
    const share = easyLeft / (chosen.length - index);
    const minutes = round5(Math.min(ceiling, Math.max(EASY_MIN_MINUTES[sport], share)));
    if (minutes < EASY_MIN_MINUTES[sport] && minutes < ceiling) return;
    const recovery = limits.easy && summary.form < -10;
    days.get(date)!.sessions.push(
      session(date, {
        kind: recovery ? "recovery" : "easy",
        sport,
        minutes: recovery ? Math.min(minutes, 45) : minutes,
        note:
          easyOnly.get(date) ??
          (limits.cap != null ? `Fits the ${limits.cap} min you have.` : null),
      }),
    );
    easyLeft -= minutes;
    left[FAMILY_OF[sport]] -= minutes;
  });

  // Second sessions: time that did not fit, or a planned sport that has none yet this week.
  const pastSeconds = dates
    .filter((date) => date < from)
    .filter((date) => days.get(date)!.sessions.some((item) => item.second)).length;
  let doubles = Math.max(0, plan.doubleDays - pastSeconds);
  const longDay = addDayKey(data.weekStart, (plan.longWeekday + 6) % 7);
  const hosts = chosen.filter((date) => {
    if (date === longDay) return false;
    const day = days.get(date)!;
    return day.sessions.length === 1 && day.sessions[0]!.kind === "easy";
  });
  const hasSport = (sport: KeySport) =>
    data.activities.some((activity) => sportGroupFor(activity.sportType)?.id === sport) ||
    [...days.values()].some((day) => day.sessions.some((item) => item.sport === sport));
  for (const date of hosts) {
    if (doubles <= 0) break;
    const day = days.get(date)!;
    const first = day.sessions[0]!;
    const uncovered = plan.sports.find(
      (sport) => !hasSport(sport) && left[FAMILY_OF[sport]] >= SPORT_COVER_MIN_MINUTES,
    );
    if (!uncovered && easyLeft < SECOND_MIN_MINUTES) break;
    const sport =
      uncovered ??
      plan.sports.find((other) => other !== first.sport && left[FAMILY_OF[other]] > 0) ??
      (first.sport as KeySport);
    const room = Math.min(SECOND_MAX_MINUTES, capOf(date) - first.minutes);
    const minutes = round5(
      Math.min(
        room,
        Math.max(SECOND_MIN_MINUTES, uncovered ? SECOND_MIN_MINUTES : easyLeft / doubles),
      ),
    );
    if (minutes < SECOND_MIN_MINUTES) continue;
    day.sessions.push(
      session(date, {
        kind: "easy",
        sport,
        minutes,
        second: true,
        note: uncovered
          ? `Keeps your ${sport === "cycling" ? "riding" : sport === "running" ? "running" : sport === "swimming" ? "swimming" : "walking"} going this week.`
          : "A second, easy session: the week's time does not fit in one a day.",
      }),
    );
    easyLeft -= minutes;
    left[FAMILY_OF[sport]] -= minutes;
    doubles -= 1;
  }

  for (const date of free) {
    const day = days.get(date)!;
    if (!day.sessions.length) day.note = easyOnly.get(date) ?? day.note;
  }

  return {
    version: WEEK_PLAN_VERSION,
    weekStart: data.weekStart,
    days: dates.map((date) => days.get(date)!),
    dropped,
    note: null,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Days around a week whose goals still shape it: a B goal's lighter days and the days after. */
const NEARBY_GOAL_DAYS = 5;

/** The goals whose days shape the week starting `weekStart`. */
export function goalsNear(goals: Goal[], weekStart: string) {
  const from = addDayKey(weekStart, -NEARBY_GOAL_DAYS);
  const to = addDayKey(weekStart, 6 + NEARBY_GOAL_DAYS);
  return goals.filter((goal) => goal.date >= from && goal.date <= to);
}

/** A week after this one, as the plan would lay it out today. */
export type WeekAhead = {
  weekStart: string;
  phase: Pick<SeasonPhase, "kind" | "lighter">;
  days: PlannedDay[];
  /** Key session names by id, for the session titles. */
  keyNames: Record<string, string>;
};

/**
 * The `count` weeks after this one, laid out by the same planner if every week until then hits
 * its target: fitness projected from this week's start, no activities, no notes. Only a preview;
 * each week is planned for real once it starts (ADR 0026), from what was actually done.
 */
export function planWeeksAhead(
  data: WeekTargetData & { plan: TrainingPlan },
  goals: Goal[],
  paces: Partial<Record<SportGroupId, GroupPace>>,
  count: number,
): WeekAhead[] {
  const recent = weekLoadsBefore(data.history, data.weekStart);
  const projected = projectSeason(
    data.weekStartFitness,
    goals,
    data.weekStart,
    addDayKey(data.weekStart, 7 * count),
    recent,
  );
  return projected.slice(1).map((week, index) => {
    const fitness = { ctl: week.ctl, atl: week.atl };
    const weekData = {
      ...data,
      weekStart: week.weekStart,
      activities: [],
      weekStartFitness: fitness,
      fitness,
      season: { ...week.phase, sessions: goalSessions(week.phase, paces) },
      nearbyGoals: goalsNear(goals, week.weekStart),
    };
    const loads = [...recent, ...projected.slice(0, index + 1).map((item) => item.load)];
    const summary = summarizeWeek(weekData, loads);
    const planned = planWeek({ data: weekData, summary, constraints: [], previous: null });
    return {
      weekStart: week.weekStart,
      phase: { kind: week.phase.kind, lighter: week.phase.lighter },
      days: planned.days,
      keyNames: Object.fromEntries(
        summary.keySessions.map((status) => [status.session.id, keySessionName(status.session)]),
      ),
    };
  });
}

export type SessionState = "done" | "missed" | "moved" | "planned";

export type SessionView = {
  session: PlannedSession;
  state: SessionState;
  activity: WeekActivity | null;
};

export type ExtraActivity = {
  activity: WeekActivity;
  /** The key session this activity ticked off away from its planned day. */
  keySessionId: string | null;
};

export type DayView = {
  day: PlannedDay;
  sessions: SessionView[];
  extras: ExtraActivity[];
};

function sameSport(activity: WeekActivity, sport: SessionSport) {
  const group = sportGroupFor(activity.sportType)?.id;
  return sport === "other" ? !group || !isKeySport(group) : group === sport;
}

/**
 * Each planned session against the copied activities: a key session is done by the activity
 * that ticked it off, a race by an activity of its sport that day, any other session by a ride,
 * run, swim, or walk of 20 minutes or more that day. A key session missed and planned again later is
 * moved. Activities left over are extra.
 */
export function matchWeek(
  plan: WeekPlan,
  data: Pick<WeekTargetData, "activities" | "today">,
  summary: Pick<WeekSummary, "keySessions">,
): DayView[] {
  const used = new Set<string>();
  const states = new Map<string, Pick<SessionView, "state" | "activity">>();
  const all = plan.days.flatMap((day) => day.sessions.map((item) => ({ date: day.date, item })));
  const past = (date: string) => date < data.today;

  // Key sessions: by the activity that ticked them off.
  const byKey = new Map<string, typeof all>();
  for (const entry of all) {
    if (entry.item.kind !== "key" || !entry.item.keySessionId) continue;
    const list = byKey.get(entry.item.keySessionId) ?? [];
    list.push(entry);
    byKey.set(entry.item.keySessionId, list);
  }
  for (const [id, entries] of byKey) {
    const done = summary.keySessions.find((status) => status.session.id === id)?.done ?? null;
    if (done) {
      used.add(done.id);
      const winner = entries.find((entry) => entry.date === done.date) ?? entries.at(-1)!;
      for (const entry of entries) {
        states.set(
          entry.item.id,
          entry === winner ? { state: "done", activity: done } : { state: "moved", activity: null },
        );
      }
      continue;
    }
    const later = entries.some((entry) => !past(entry.date));
    for (const entry of entries) {
      states.set(entry.item.id, {
        state: !past(entry.date) ? "planned" : later ? "moved" : "missed",
        activity: null,
      });
    }
  }

  // Races, then everything else on its own day, the sport's own activity first.
  const fill = (entries: typeof all, minMinutes: number) => {
    for (const { date, item } of entries) {
      const candidates = data.activities.filter(
        (activity) =>
          activity.date === date &&
          !used.has(activity.id) &&
          activity.minutes >= minMinutes &&
          !isOtherSportType(activity.sportType),
      );
      const match =
        candidates.find((activity) => sameSport(activity, item.sport)) ??
        (item.kind === "race" ? undefined : candidates[0]);
      if (match) {
        used.add(match.id);
        states.set(item.id, { state: "done", activity: match });
      } else {
        states.set(item.id, { state: past(date) ? "missed" : "planned", activity: null });
      }
    }
  };
  fill(
    all.filter((entry) => entry.item.kind === "race"),
    1,
  );
  fill(
    all.filter((entry) => entry.item.kind !== "race" && entry.item.kind !== "key"),
    EASY_SESSION_MIN_MINUTES,
  );

  const ticked = new Map(
    summary.keySessions.flatMap((status) =>
      status.done ? [[status.done.id, status.session.id] as const] : [],
    ),
  );
  return plan.days.map((day) => ({
    day,
    sessions: day.sessions.map((item) => ({
      session: item,
      ...(states.get(item.id) ?? { state: "planned" as const, activity: null }),
    })),
    extras: data.activities
      .filter((activity) => activity.date === day.date && !used.has(activity.id))
      .map((activity) => ({ activity, keySessionId: ticked.get(activity.id) ?? null })),
  }));
}

/** What a planned session costs, roughly, from how costly an hour usually is for the athlete. */
function plannedLoad(item: PlannedSession, loadPerHour: number) {
  const factor =
    item.kind === "key" ? 1.3 : item.kind === "race" ? 1.4 : item.kind === "recovery" ? 0.7 : 1;
  return (item.minutes / 60) * loadPerHour * factor;
}

/** Fitness on Sunday and form on Monday if the athlete does what is still planned. */
export function projectPlan(
  views: DayView[],
  data: Pick<WeekTargetData, "fitness" | "today">,
  summary: Pick<WeekSummary, "loadPerHour">,
): WeekProjection {
  let { ctl, atl } = data.fitness;
  for (const view of views) {
    if (view.day.date < data.today) continue;
    const load = view.sessions
      .filter((item) => item.state === "planned")
      .reduce((sum, item) => sum + plannedLoad(item.session, summary.loadPerHour), 0);
    if (view.day.date === data.today) {
      // Today's fitness already counts what is done today.
      ctl += load / CTL_DAYS;
      atl += load / ATL_DAYS;
    } else {
      ctl += (load - ctl) / CTL_DAYS;
      atl += (load - atl) / ATL_DAYS;
    }
  }
  return {
    fitnessNow: data.fitness.ctl,
    fitnessSunday: ctl,
    formMonday: ctl - atl,
    formMondayLabel: formLabel(ctl - atl),
  };
}

/** Minutes planned and done this week, for the week bar. */
export function weekMinutes(views: DayView[]) {
  let planned = 0;
  let done = 0;
  let missed = 0;
  for (const view of views) {
    for (const item of view.sessions) {
      if (item.state === "moved") continue;
      if (item.state === "done") done += item.activity?.minutes ?? item.session.minutes;
      else if (item.state === "missed") missed += item.session.minutes;
      else planned += item.session.minutes;
    }
    for (const extra of view.extras) done += extra.activity.minutes;
  }
  return { done, missed, planned, total: done + planned };
}

/** The session page for one planned session: its steps, cues, and effect on the week. */
export function sessionRecommendation(
  data: WeekTargetData & { plan: TrainingPlan },
  summary: WeekSummary,
  day: PlannedDay,
  item: PlannedSession,
): Recommendation | null {
  const reasons = [item.note ?? day.note].filter((reason): reason is string => Boolean(reason));
  if (item.kind === "race") {
    return buildRecommendation(
      {
        kind: "race",
        keySession: null,
        parts: [],
        reasons: [day.note ? `Race day: ${day.note}.` : "Race day."],
      },
      data,
      summary,
    );
  }
  if (item.sport === "other" || item.minutes <= 0) return null;
  if (item.kind === "key" || item.kind === "opener") {
    const base =
      item.kind === "opener"
        ? OPENER
        : summary.keySessions.find((status) => status.session.id === item.keySessionId)?.session;
    if (!base) return null;
    const fitted = fitKeySession({ ...base, sport: item.sport }, item.minutes);
    return buildRecommendation(
      {
        kind: "key",
        keySession: fitted,
        parts: [{ sport: item.sport, minutes: keySessionMinutes(fitted), main: true }],
        reasons,
      },
      data,
      summary,
    );
  }
  return buildRecommendation(
    {
      kind: item.kind,
      keySession: null,
      parts: [{ sport: item.sport, minutes: item.minutes, main: true }],
      reasons,
    },
    data,
    summary,
  );
}

/** The coach's side of the week page: the athlete's notes and the week plan made with them. */
export type WeekCoachState = {
  weekStart: string;
  notes: CoachNote[];
  plan: WeekPlan | null;
  /** The plan predates a sync, a note, or a settings change; planning again brings it up to date. */
  stale: boolean;
  /** Goals on Season that would reshape weeks of the current block, until the plan adapts. */
  seasonChange: PlanImpact | null;
  /** A plan saved before the plan builder: it follows Season and asks to be reviewed. */
  needsReview: boolean;
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

/** What the model returns: the constraints it read and a short note to the athlete. */
export const coachReadingSchema = z.object({
  constraints: z.array(dayConstraintSchema).max(14),
  note: z.string().min(1).max(500),
});

export type CoachReading = z.infer<typeof coachReadingSchema>;

/** Constraints the model read from the athlete's words, kept only for days of this week. */
export function acceptConstraints(raw: DayConstraint[], dates: string[]) {
  const allowed = new Set(dates);
  return raw.filter((constraint) => allowed.has(constraint.date));
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

/** Key sessions done or missed: when either changes, the days after today are planned again. */
export function replanSignals(
  plan: WeekPlan | null,
  data: Pick<WeekTargetData, "today">,
  summary: Pick<WeekSummary, "keySessions">,
) {
  const done = summary.keySessions
    .filter((status) => status.done)
    .map((status) => status.session.id)
    .sort();
  const planned = new Set<string>();
  const missed: string[] = [];
  for (const day of plan?.days ?? []) {
    for (const item of day.sessions) {
      if (item.kind !== "key" || !item.keySessionId) continue;
      if (day.date >= data.today) planned.add(item.keySessionId);
      else if (!done.includes(item.keySessionId)) missed.push(item.keySessionId);
    }
  }
  return { done, missed: missed.filter((id) => !planned.has(id)).sort() };
}
