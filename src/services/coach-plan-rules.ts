import {
  dayMinutes,
  isLongKind,
  isQualityKind,
  type Availability,
  type PlannedRun,
} from "./coach-plan.types.ts";
import type { WeekBudget, RunDay } from "./coach-plan-budget.ts";
import { addDayKey } from "./day-key.ts";

/*
 * The rules of ADR 0037, checked in code on every plan the coach writes. Each check is a pure
 * function of the plan and what VO2 knows, returning the rules it breaks in words the coach can
 * act on. A plan that breaks any goes back to the coach (coach-plan.server.ts).
 */

export type RuleBreak = { rule: string; message: string };

export type RuleContext = {
  availability: Availability;
  weeks: WeekBudget[];
  /** The first day written; days before it are frozen. */
  from: string;
  today: string;
  /** Sessions kept from the previous plan, before `from`, in the weeks being written. */
  frozen: PlannedRun[];
  /** The athlete's runs before today, for the longest of the last 30 days. */
  runs: RunDay[];
  /** Running goals in the weeks written: VO2 puts the race on its day, the coach writes none. */
  raceDays: string[];
};

/** A week may come in this much over its budget, for rounding. */
const BUDGET_TOLERANCE = 1.05;
/** A run may be at most this much longer than the longest of the last 30 days (rule 2). */
const MAX_RUN_GROWTH = 1.1;
/** With no run in the last 30 days, runs up to this long still count as within rule 2. */
const MIN_LONGEST_KM = 5;
const LONGEST_WINDOW_DAYS = 30;
/** The long run is at most 2 h 30 (rule 5). */
export const MAX_LONG_MINUTES = 150;

/** Quality sessions a week (rule 4): 1 for 2–3 runs, 2 for 4–5, at most 3 for 6. */
export function maxQualitySessions(runsPerWeek: number) {
  return runsPerWeek <= 3 ? 1 : runsPerWeek <= 5 ? 2 : 3;
}

/**
 * The long run's largest share of the week (rule 5), by the runs in that week. It is 30 %, but
 * with two or three runs even equal runs are half or a third of the week, so those weeks allow
 * 50 % and 40 %, and a week of one run has no share to keep.
 */
export function maxLongShare(runsInWeek: number) {
  if (runsInWeek <= 1) return 1;
  return runsInWeek === 2 ? 0.5 : runsInWeek === 3 ? 0.4 : 0.3;
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const km = (value: number) => `${Math.round(value * 10) / 10} km`;
const weekOf = (weeks: WeekBudget[], date: string) =>
  weeks.find((week) => date >= week.weekStart && date < addDayKey(week.weekStart, 7));

/** Steps that read as one thing: a distance or a time, and a pace or an effort. */
export function formatBreaks(sessions: PlannedRun[]): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const session of sessions) {
    const bad = session.blocks.some((block) =>
      block.steps.some(
        (step) =>
          (step.distanceM == null) === (step.durationS == null) ||
          (step.pace == null) === (step.effort == null) ||
          (step.distanceM ?? step.durationS ?? 0) <= 0,
      ),
    );
    if (bad) {
      breaks.push({
        rule: "format",
        message: `${session.date}: every step needs exactly one of distanceM or durationS (above 0), and exactly one of pace or effort.`,
      });
    }
  }
  return breaks;
}

/** Dates inside the weeks written, from the first written day; one run a day; no race days. */
export function dateBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const last = addDayKey(ctx.weeks.at(-1)!.weekStart, 6);
  const taken = new Set(ctx.frozen.map((session) => session.date));
  for (const session of sessions) {
    if (session.date < ctx.from || session.date > last) {
      breaks.push({
        rule: "dates",
        message: `${session.date}: write sessions from ${ctx.from} to ${last} only.`,
      });
    } else if (ctx.raceDays.includes(session.date)) {
      breaks.push({
        rule: "dates",
        message: `${session.date} is a race day: VO2 adds the race itself, write no session on it.`,
      });
    } else if (taken.has(session.date)) {
      breaks.push({
        rule: "8. no doubling",
        message: `${session.date} has two runs. One run a day at most; a missed session is skipped, never made up.`,
      });
    }
    taken.add(session.date);
  }
  return breaks;
}

/** Runs only on the athlete's days, within each day's time, the long run on its day. */
export function availabilityBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const { availability } = ctx;
  const breaks: RuleBreak[] = [];
  for (const session of sessions) {
    const minutes = dayMinutes(availability, weekday(session.date));
    if (minutes == null) {
      breaks.push({
        rule: "availability",
        message: `${session.date}: the athlete can't run on that weekday.`,
      });
    } else if (session.minutes > minutes) {
      breaks.push({
        rule: "availability",
        message: `${session.date}: about ${session.minutes} min, but the athlete has ${minutes} min that day.`,
      });
    }
    if (isLongKind(session.kind) && weekday(session.date) !== availability.longRunDay) {
      breaks.push({
        rule: "availability",
        message: `${session.date}: the long run goes on the athlete's long run day.`,
      });
    }
  }
  for (const week of ctx.weeks) {
    const count = [...ctx.frozen, ...sessions].filter(
      (session) => weekOf(ctx.weeks, session.date) === week,
    ).length;
    if (count > availability.runsPerWeek) {
      breaks.push({
        rule: "availability",
        message: `Week of ${week.weekStart}: ${count} runs, but the athlete runs ${availability.runsPerWeek} a week.`,
      });
    }
  }
  return breaks;
}

/**
 * Rules 1, 6, and 7: each week's distance stays inside its budget, which is lighter every fourth
 * week and in the taper. Sessions kept from before the rewrite count as planned, done or not, so
 * a missed run's distance can't be added to the days after it (rule 8).
 */
export function budgetBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const week of ctx.weeks) {
    const inWeek = (session: PlannedRun) => weekOf(ctx.weeks, session.date) === week;
    // Days kept alone may already pass the budget; then the coach's part is to add nothing.
    if (!sessions.some(inWeek)) continue;
    const total = [...ctx.frozen, ...sessions]
      .filter(inWeek)
      .reduce((sum, session) => sum + session.distanceKm, 0);
    if (total <= week.budgetKm * BUDGET_TOLERANCE) continue;
    const rule = week.taper ? "7. taper" : week.lighter ? "6. lighter week" : "1. weekly budget";
    const kind = week.taper ? "a taper week" : week.lighter ? "a lighter week" : "budgeted";
    breaks.push({
      rule,
      message: `Week of ${week.weekStart} is ${kind} at ${km(week.budgetKm)}, but the plan has ${km(total)}.`,
    });
  }
  return breaks;
}

/** Rule 2: no run more than 10 % longer than the longest of the 30 days before it. */
export function spikeBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  // Before today, what the athlete ran; from today, what the plan asks.
  const ahead = [...ctx.frozen.filter((session) => session.date >= ctx.today), ...sessions];
  const before = [
    ...ctx.runs.filter((run) => run.date < ctx.today),
    ...ahead.map((session) => ({ date: session.date, km: session.distanceKm })),
  ];
  for (const session of sessions) {
    const since = addDayKey(session.date, -LONGEST_WINDOW_DAYS);
    const longest = Math.max(
      MIN_LONGEST_KM,
      ...before.filter((run) => run.date >= since && run.date < session.date).map((run) => run.km),
    );
    const limit = longest * MAX_RUN_GROWTH;
    if (session.distanceKm > limit + 0.05) {
      breaks.push({
        rule: "2. longest run",
        message: `${session.date}: ${km(session.distanceKm)}, but the longest run in the 30 days before is ${km(longest)}, so ${km(limit)} at most.`,
      });
    }
  }
  return breaks;
}

/**
 * Rule 3: never two hard days in a row, nor the long run the day after a hard day. Races are hard
 * days. Only pairs with a new session count: the coach can't change the days kept before.
 */
export function hardDayBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  type Day = { hard: boolean; long: boolean; written: boolean };
  const byDate = new Map<string, Day>();
  for (const session of ctx.frozen) {
    byDate.set(session.date, { hard: isQualityKind(session.kind), long: false, written: false });
  }
  for (const date of ctx.raceDays) byDate.set(date, { hard: true, long: false, written: false });
  for (const session of sessions) {
    byDate.set(session.date, {
      hard: isQualityKind(session.kind),
      long: isLongKind(session.kind),
      written: true,
    });
  }
  const breaks: RuleBreak[] = [];
  for (const [date, day] of byDate) {
    const before = byDate.get(addDayKey(date, -1));
    if (!before?.hard || !(day.hard || day.long) || !(day.written || before.written)) continue;
    const what = ctx.raceDays.includes(date)
      ? "a race"
      : day.long
        ? "the long run"
        : "a hard session";
    breaks.push({
      rule: "3. hard days",
      message: `${date}: ${what} the day after a hard day. Put an easy run or a rest day between them.`,
    });
  }
  return breaks;
}

/** Rule 4 per week, and rule 5: the long run's share of the week and its time. */
export function weekShapeBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const { runsPerWeek } = ctx.availability;
  const maxQuality = maxQualitySessions(runsPerWeek);
  for (const week of ctx.weeks) {
    const inWeek = [...ctx.frozen, ...sessions].filter(
      (session) => weekOf(ctx.weeks, session.date) === week,
    );
    const races = ctx.raceDays.filter((date) => weekOf(ctx.weeks, date) === week).length;
    const quality = inWeek.filter((session) => isQualityKind(session.kind)).length + races;
    if (quality > maxQuality) {
      breaks.push({
        rule: "4. quality sessions",
        message: `Week of ${week.weekStart}: ${quality} quality sessions${races ? " (races count)" : ""}, at most ${maxQuality} with ${runsPerWeek} runs a week.`,
      });
    }
    const total = inWeek.reduce((sum, session) => sum + session.distanceKm, 0);
    const longs = inWeek.filter((session) => isLongKind(session.kind));
    const longShare = maxLongShare(inWeek.length);
    if (longs.length > 1) {
      breaks.push({
        rule: "5. long run",
        message: `Week of ${week.weekStart}: one long run a week.`,
      });
    }
    for (const long of longs) {
      if (long.distanceKm > total * longShare + 0.05) {
        breaks.push({
          rule: "5. long run",
          message: `${long.date}: the long run is ${km(long.distanceKm)} of a ${km(total)} week, over ${Math.round(longShare * 100)} % for a week of ${inWeek.length} runs.`,
        });
      }
      if (long.minutes > MAX_LONG_MINUTES) {
        breaks.push({
          rule: "5. long run",
          message: `${long.date}: the long run takes about ${long.minutes} min, over 2 h 30.`,
        });
      }
    }
  }
  return breaks;
}

/** Every rule the plan's new sessions break; empty when it passes. */
export function checkPlan(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  return [
    ...formatBreaks(sorted),
    ...dateBreaks(sorted, ctx),
    ...availabilityBreaks(sorted, ctx),
    ...budgetBreaks(sorted, ctx),
    ...spikeBreaks(sorted, ctx),
    ...hardDayBreaks(sorted, ctx),
    ...weekShapeBreaks(sorted, ctx),
  ];
}
