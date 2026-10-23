import { z } from "zod";

import type { PlanImpact } from "./plan-impact.ts";
import { AROUND_GOAL } from "./season-phase.ts";
import type { Goal, SeasonWeek } from "./season.types.ts";
import { sportGroupFor } from "./sport-groups.ts";
import {
  KEY_SPORTS,
  MAX_DOUBLE_DAYS,
  MAX_REST_DAYS,
  addDayKey,
  dayKey,
  defaultLongWeekday,
  isKeySport,
  keySessionCountFor,
  weekShapeFields,
  withWeekShapeIssues,
  type KeySport,
  type PlanGoal,
  type WeekShape,
} from "./training-plan.types.ts";
import type { PlannedDay } from "./week-plan.ts";

// The plan builder (ADR 0026): every answer starts from the athlete's last 12 weeks.

/** Complete weeks of history the builder reads. */
export const BUILDER_HISTORY_WEEKS = 12;
/** A weekday trained on less often than this is suggested as a rest day. */
const REST_DAY_SHARE = 0.3;
/** A sport below this share of recent time is not suggested for the plan. */
const SPORT_MIN_SHARE = 0.1;
/** Activities shorter than this are not sessions (a warm-up, a commute). */
const SESSION_MIN_MINUTES = 20;
/** Without history: train Tuesday, Thursday, Saturday, and Sunday. */
export const NO_HISTORY_REST_WEEKDAYS = [1, 3, 5];

export type BuilderActivity = {
  startDate: Date;
  movingTime: number;
  sportType: string;
  distance: number | null;
};

export type HistoryStats = {
  /** Weeks read, oldest first: whether each had any activity. */
  weeks: number;
  /** Average minutes a week, and the usual low and high weeks (20th and 80th percentile). */
  weeklyMinutes: { average: number; low: number; high: number };
  sessionsPerWeek: number;
  /** Average days a week with two sessions or more. */
  doubleDaysPerWeek: number;
  /** Share of weeks with a session on each weekday, Sunday first. */
  weekdayShare: number[];
  /** Share of time per sport with heart-rate zones. */
  sportShare: Record<KeySport, number>;
  longest: {
    minutes: number;
    date: string;
    sport: KeySport | null;
    distanceM: number | null;
  } | null;
  /** Weekday the week's longest activity most often falls on, or null. */
  usualLongWeekday: number | null;
};

function percentile(sorted: number[], share: number) {
  return sorted[Math.round((sorted.length - 1) * share)] ?? 0;
}

/** The last 12 complete weeks before `weekStart`, read for the builder's suggestions. */
export function historyStats(
  rows: BuilderActivity[],
  weekStart: string,
  timeZone: string,
): HistoryStats {
  const from = addDayKey(weekStart, -7 * BUILDER_HISTORY_WEEKS);
  const weeks = Array.from({ length: BUILDER_HISTORY_WEEKS }, () => ({
    minutes: 0,
    sessions: 0,
    days: new Map<number, number>(),
    longest: null as { minutes: number; weekday: number } | null,
  }));
  const sportMinutes: Record<KeySport, number> = {
    cycling: 0,
    running: 0,
    swimming: 0,
    walking: 0,
  };
  let longest: HistoryStats["longest"] = null;
  let total = 0;
  for (const row of rows) {
    const date = dayKey(row.startDate, timeZone);
    if (date < from || date >= weekStart) continue;
    const minutes = Math.round(row.movingTime / 60);
    const index = Math.floor(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (7 * 86_400_000),
    );
    const week = weeks[index];
    if (!week) continue;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    week.minutes += minutes;
    total += minutes;
    const group = sportGroupFor(row.sportType)?.id;
    if (group && isKeySport(group)) sportMinutes[group] += minutes;
    if (minutes < SESSION_MIN_MINUTES) continue;
    week.sessions += 1;
    week.days.set(weekday, (week.days.get(weekday) ?? 0) + 1);
    if (!week.longest || minutes > week.longest.minutes) week.longest = { minutes, weekday };
    if (!longest || minutes > longest.minutes) {
      longest = {
        minutes,
        date,
        sport: group && isKeySport(group) ? group : null,
        distanceM: row.distance,
      };
    }
  }
  // A history shorter than 12 weeks is read from its first week, not padded with empty weeks.
  const firstActive = weeks.findIndex((week) => week.minutes > 0);
  const span = firstActive < 0 ? weeks : weeks.slice(firstActive);
  const spanWeeks = Math.max(1, span.length);
  const sortedMinutes = span.map((week) => week.minutes).sort((a, b) => a - b);
  const weekdayShare = Array.from(
    { length: 7 },
    (_, weekday) => span.filter((week) => week.days.has(weekday)).length / spanWeeks,
  );
  const longDays = new Map<number, number>();
  for (const week of weeks) {
    if (week.longest)
      longDays.set(week.longest.weekday, (longDays.get(week.longest.weekday) ?? 0) + 1);
  }
  const usualLongWeekday =
    [...longDays].sort((a, b) => b[1] - a[1] || weekendFirst(a[0]) - weekendFirst(b[0]))[0]?.[0] ??
    null;
  const sportTotal = KEY_SPORTS.reduce((sum, sport) => sum + sportMinutes[sport], 0);
  return {
    weeks: weeks.filter((week) => week.minutes > 0).length,
    weeklyMinutes: {
      average: Math.round(total / spanWeeks),
      low: percentile(sortedMinutes, 0.2),
      high: percentile(sortedMinutes, 0.8),
    },
    sessionsPerWeek: span.reduce((sum, week) => sum + week.sessions, 0) / spanWeeks,
    doubleDaysPerWeek:
      span.reduce((sum, week) => sum + [...week.days.values()].filter((n) => n >= 2).length, 0) /
      spanWeeks,
    weekdayShare,
    sportShare: Object.fromEntries(
      KEY_SPORTS.map((sport) => [sport, sportTotal > 0 ? sportMinutes[sport] / sportTotal : 0]),
    ) as Record<KeySport, number>,
    longest,
    usualLongWeekday,
  };
}

/** Saturday, then Sunday, then the rest of the week: where long sessions usually go. */
function weekendFirst(weekday: number) {
  return [6, 0, 5, 4, 3, 2, 1].indexOf(weekday);
}

/** The week shape the builder starts from: the athlete's own habits, or a simple default. */
export function suggestedShape(stats: HistoryStats, goals: Goal[]): WeekShape {
  const hasHistory = stats.weeks >= 3;
  let restWeekdays = NO_HISTORY_REST_WEEKDAYS;
  if (hasHistory) {
    const byShare = Array.from({ length: 7 }, (_, weekday) => weekday).sort(
      (a, b) =>
        stats.weekdayShare[a]! - stats.weekdayShare[b]! || weekendFirst(b) - weekendFirst(a),
    );
    const rare = byShare.filter((weekday) => stats.weekdayShare[weekday]! < REST_DAY_SHARE);
    restWeekdays = (rare.length ? rare : byShare.slice(0, 1)).slice(0, MAX_REST_DAYS);
  }
  restWeekdays = [...restWeekdays].sort((a, b) => a - b);
  const trainingDays = 7 - restWeekdays.length;
  const longWeekday =
    stats.usualLongWeekday != null && !restWeekdays.includes(stats.usualLongWeekday)
      ? stats.usualLongWeekday
      : defaultLongWeekday(restWeekdays);
  const goalSports = goals.flatMap((goal) => {
    const group = sportGroupFor(goal.sportType)?.id;
    return group && isKeySport(group) ? [group] : [];
  });
  const usual = KEY_SPORTS.filter((sport) => stats.sportShare[sport] >= SPORT_MIN_SHARE);
  const sports = KEY_SPORTS.filter((sport) => usual.includes(sport) || goalSports.includes(sport));
  return {
    restWeekdays,
    longWeekday,
    doubleDays: Math.min(MAX_DOUBLE_DAYS, trainingDays, Math.round(stats.doubleDaysPerWeek)),
    sports: sports.length ? sports : ["cycling", "running"],
  };
}

const OBJECTIVE_WORDS = {
  finish: "finish",
  finishWell: "finish well",
  perform: "perform",
} as const;

/** How one goal shapes the plan, in words, by its priority and objective (ADR 0026). */
export function goalEffect(goal: Goal, leads: boolean) {
  const around = AROUND_GOAL[goal.priority][goal.objective];
  if (leads) {
    const keys = keySessionCountFor({ objective: goal.objective, phaseMax: null, trainingDays: 7 });
    const build =
      goal.priority === "A"
        ? "Base, build, peak, and taper toward it"
        : "The plan builds toward it";
    return `${build}, with ${keys} key session${keys === 1 ? "" : "s"} a week to ${OBJECTIVE_WORDS[goal.objective]}.`;
  }
  if (goal.priority === "A")
    return "Its own build, peak, and taper once the goal before it is done.";
  const parts: string[] = [];
  if (around.easyBefore) {
    parts.push(
      `${around.easyBefore} ${goal.priority === "B" ? "lighter" : "easy"} day${around.easyBefore === 1 ? "" : "s"} before`,
    );
  }
  if (around.opener) parts.push("an opener the day before");
  if (around.easyAfter)
    parts.push(`${around.easyAfter} easy day${around.easyAfter === 1 ? "" : "s"} after`);
  const lead = goal.priority === "C" ? "Trained through: it counts as a hard session" : "A tune-up";
  const week = goal.priority === "B" && goal.objective === "perform" ? ", in a week at 85 %" : "";
  return parts.length ? `${lead}; ${parts.join(", ")}${week}.` : `${lead}.`;
}

/** What the builder sends to preview or start a plan. */
export const planDraftSchema = withWeekShapeIssues(
  z.object({
    ...weekShapeFields,
    /** Weekly minutes to start from after a break, or null to start from history. */
    baselineMinutes: z.number().int().min(30).max(1800).nullable(),
    timeZone: z.string().min(1),
  }),
);

export type PlanDraft = z.infer<typeof planDraftSchema>;

/** The plan's own copy of the goals (ADR 0026): what it reads its phases from. */
export function planGoalsFrom(goals: Goal[]): PlanGoal[] {
  return goals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    sportType: goal.sportType,
    date: goal.date,
    distanceM: goal.distanceM,
    elevationGainM: goal.elevationGainM,
    objective: goal.objective,
    priority: goal.priority,
  }));
}

/** What the builder starts from: the season's goals and what the last 12 weeks say. */
export type BuilderData = {
  today: string;
  weekStart: string;
  timeZone: string;
  /** Upcoming goals on Season, by date. */
  goals: Goal[];
  stats: HistoryStats;
  fitness: { ctl: number; form: number };
  /** The week shape the athlete's history suggests. */
  suggested: WeekShape;
  /** The saved plan's shape, when rebuilding. */
  current: (WeekShape & { baselineMinutes: number | null }) | null;
};

export type PlanPreview = {
  /** Every week from this one to a week after the last goal, as the season map shows them. */
  weeks: SeasonWeek[];
  /** This week as the plan would lay it out from today. */
  days: PlannedDay[];
  /** Form on the leading goal's morning if every week hits its target. */
  raceDayForm: number | null;
};

export type SeasonCheck = {
  hasPlan: boolean;
  /** Weeks a Season change would reshape, waiting for the athlete to adapt or keep the plan. */
  impact: PlanImpact | null;
  /** Set when the change went into the plan at once: what it changes, in words. */
  adopted: string | null;
};
