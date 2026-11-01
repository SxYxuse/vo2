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
  /**
   * Planned sessions from yesterday on outside the days being written, such as the weeks kept
   * when only a new week is added. They are neighbours for the longest run and hard days, but
   * count toward no week being written.
   */
  neighbours: PlannedRun[];
  /** Seconds per km at the middle of easy pace, to size what a day's time allows. */
  easySecPerKm: number;
  /**
   * Set when checking a plan change (ADR 0038): a week may then end under its floor, since an
   * athlete who is ill or away runs less, and less running breaks no safety rule.
   */
  allowShort?: true;
};

/** A week may come in this much over its budget, for rounding. */
const BUDGET_TOLERANCE = 1.05;
/**
 * A full week must reach this share of its budget: the coaching knowledge asks for 95–100 %, and
 * the gap leaves room for rounding. Rest of the limits may hold a week lower; see weekFloorKm.
 */
const BUDGET_FLOOR = 0.9;
/** What the day's time and the longest-run rule allow is estimated, so only this much counts. */
const REACH_SHARE = 0.85;
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
 * The longest run's largest share of the week (rule 5), by the runs the athlete's availability
 * allows that week (runsAvailable). It is 30 %. With two or three runs even equal runs are half or
 * a third of the week, so those weeks allow 50 % and 40 % (ADR 0040); these two values wait on the
 * coach's review and live only here. A week of one run has no share to keep.
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

/** The week's days, oldest first. */
const datesOf = (week: WeekBudget) =>
  Array.from({ length: 7 }, (_, index) => addDayKey(week.weekStart, index));

/**
 * Runs the athlete's availability allows in the week: their runs per week, or fewer when the
 * written part of the week has fewer of their days left (a week rewritten from Thursday, or one
 * with a race on a running day). Sessions kept from before count as runs.
 */
export function runsAvailable(week: WeekBudget, ctx: RuleContext) {
  const dates = datesOf(week);
  // A plan change keeps days after `from` too; those are counted with the open days.
  const kept = ctx.frozen.filter(
    (session) => dates.includes(session.date) && session.date < ctx.from,
  ).length;
  const open = dates.filter(
    (date) =>
      date >= ctx.from &&
      !ctx.raceDays.includes(date) &&
      dayMinutes(ctx.availability, weekday(date)) != null,
  ).length;
  return Math.min(ctx.availability.runsPerWeek, kept + open);
}

/** VO2 asks for no run under this, the no-history floor's km per run. */
const MIN_RUN_KM = 3;

/**
 * The runs the longest-run share is read for: the runs available (runsAvailable), but no more
 * than the budget holds at 3 km each, so a small taper or recovery week isn't asked for 2 km runs.
 */
export function longShareRuns(week: WeekBudget, ctx: RuleContext) {
  return Math.max(1, Math.min(runsAvailable(week, ctx), Math.floor(week.budgetKm / MIN_RUN_KM)));
}

/**
 * The largest week those day caps allow under the longest-run share (rule 5): the largest W where
 * each run can be min(cap, share × W) and together they still make W. What the days hold at that
 * share only grows more slowly than W once a cap binds, so the weeks that fit run from 0 to one
 * largest W, which halving finds.
 */
function largestWeek(caps: number[], share: number) {
  const holds = (week: number) =>
    caps.reduce((sum, cap) => sum + Math.min(cap, share * week), 0) >= week - 1e-9;
  let low = 0;
  let high = caps.reduce((sum, cap) => sum + cap, 0);
  for (let step = 0; step < 50; step += 1) {
    const mid = (low + high) / 2;
    if (holds(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * The least a week must reach (rule 1), or null when it has no floor: a week written only in part,
 * a race week, and a taper week can come in lower. The floor is 90 % of the budget, or of what the
 * athlete's days allow when their time or the longest-run rule caps the week lower.
 */
export function weekFloorKm(week: WeekBudget, ctx: RuleContext): number | null {
  if (ctx.allowShort || week.weekStart < ctx.from || week.taper) return null;
  const dates = datesOf(week);
  if (dates.some((date) => ctx.raceDays.includes(date))) return null;
  const since = addDayKey(ctx.today, -LONGEST_WINDOW_DAYS);
  const longest = Math.max(
    MIN_LONGEST_KM,
    ...ctx.runs.filter((run) => run.date >= since && run.date < ctx.today).map((run) => run.km),
  );
  // What each of the athlete's days allows: its time at easy pace, no run past the longest-run
  // rule, and none over 2 h 30 (the week's longest run is held to it, so any run is). The long run
  // day is counted even when it is the shortest, since that is where the coach puts the long run;
  // the other days are the best of the rest.
  const runs = longShareRuns(week, ctx);
  const capOf = (minutes: number) =>
    Math.min(
      (Math.min(minutes, MAX_LONG_MINUTES) * 60) / ctx.easySecPerKm,
      longest * MAX_RUN_GROWTH,
    );
  const longDay = ctx.availability.days.find((day) => day.weekday === ctx.availability.longRunDay);
  const caps = [
    ...(longDay ? [capOf(longDay.minutes)] : []),
    ...ctx.availability.days
      .filter((day) => day !== longDay)
      .map((day) => capOf(day.minutes))
      .sort((a, b) => b - a),
  ].slice(0, runs);
  const reach = largestWeek(caps, maxLongShare(runs)) * REACH_SHARE;
  return Math.round(Math.min(week.budgetKm, reach) * BUDGET_FLOOR * 10) / 10;
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
    const floor = weekFloorKm(week, ctx);
    if (floor != null && total < floor) {
      breaks.push({
        rule: "1. weekly budget",
        message: `Week of ${week.weekStart} has ${km(total)}, under ${km(floor)}: plan 95–100 % of its ${km(week.budgetKm)} budget.`,
      });
      continue;
    }
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
  const ahead = [...ctx.frozen, ...ctx.neighbours, ...sessions].filter(
    (session) => session.date >= ctx.today && session.kind !== "race",
  );
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
  for (const session of [...ctx.neighbours, ...ctx.frozen]) {
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
    if (inWeek.filter((session) => isLongKind(session.kind)).length > 1) {
      breaks.push({
        rule: "5. long run",
        message: `Week of ${week.weekStart}: one long run a week.`,
      });
    }
    // The week's longest run counts whatever it is called, so a long run can't pass as easy.
    const longest = [...inWeek].sort((a, b) => b.distanceKm - a.distanceKm)[0];
    const runs = longShareRuns(week, ctx);
    const longShare = maxLongShare(runs);
    if (longest && sessions.includes(longest)) {
      if (longest.distanceKm > total * longShare + 0.05) {
        breaks.push({
          rule: "5. long run",
          message: `${longest.date}: the week's longest run is ${km(longest.distanceKm)} of a ${km(total)} week, over ${Math.round(longShare * 100)} % for ${runs} runs a week.`,
        });
      }
    }
    for (const run of inWeek.filter((item) => sessions.includes(item))) {
      if ((run === longest || isLongKind(run.kind)) && run.minutes > MAX_LONG_MINUTES) {
        breaks.push({
          rule: "5. long run",
          message: `${run.date}: the long run takes about ${run.minutes} min, over 2 h 30.`,
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
