import {
  isLongKind,
  isQualityKind,
  type Availability,
  type PlannedRun,
} from "./coach-plan.types.ts";
import type { WeekBudget, RunDay } from "./coach-plan-budget.ts";
import { addDayKey } from "./day-key.ts";
import { daysBetween } from "./season.types.ts";

/*
 * The rules of ADR 0037, checked in code on every plan the coach writes. Each check is a pure
 * function of the plan and what VO2 knows, returning the rules it breaks in words the coach can
 * act on. A plan that breaks any goes back to the coach (coach-plan.server.ts). Sessions have no
 * day (ADR 0048), so every rule reads them by week, and none is about neighbouring days.
 */

export type RuleBreak = { rule: string; message: string };

export type RuleContext = {
  availability: Availability;
  weeks: WeekBudget[];
  /** The first week written; weeks before it are kept as they are. */
  fromWeek: string;
  today: string;
  /** Sessions kept in the weeks being written: the ones the athlete marked done. */
  frozen: PlannedRun[];
  /** The athlete's runs before today, for the longest of the last 30 days. */
  runs: RunDay[];
  /** The week of each upcoming running goal in the weeks written: VO2 adds the race itself. */
  raceWeeks: string[];
  /**
   * Planned sessions of this week on outside the weeks being written, such as the weeks kept when
   * only a new week is added. They count toward the longest-run limit of the weeks after them, but
   * toward no week being written.
   */
  neighbours: PlannedRun[];
  /** Seconds per km at the middle of easy pace, to size a 2 h 30 run for the floor. */
  easySecPerKm: number;
  /**
   * Set when checking a plan change (ADR 0038): a week may then end under its floor, since an
   * athlete who is ill or away runs less, and less running breaks no safety rule, and the long
   * run's share is read by the runs left in the week, as long as the week's longest run doesn't
   * grow past `longestBefore`.
   */
  allowShort?: true;
  /** For a plan change: each week's longest run before it, by week start. */
  longestBefore?: Record<string, number>;
};

/** A week may come in this much over its budget, for rounding. */
const BUDGET_TOLERANCE = 1.05;
/**
 * A full week must reach this share of its budget: the coaching knowledge asks for 95–100 %, and
 * the gap leaves room for rounding. The longest-run rules may hold a week lower; see weekFloorKm.
 */
const BUDGET_FLOOR = 0.9;
/** What the longest-run rules allow is estimated from easy pace, so only this much counts. */
const REACH_SHARE = 0.85;
/** A run may be at most this much longer than the longest of the last 30 days (rule 2). */
const MAX_RUN_GROWTH = 1.1;
/** With no run in the last 30 days, runs up to this long still count as within rule 2. */
const MIN_LONGEST_KM = 5;
const LONGEST_WINDOW_DAYS = 30;
/** Planned weeks read for rule 2: the four before a session's week. */
const LONGEST_WINDOW_WEEKS = 4;
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

const km = (value: number) => `${Math.round(value * 10) / 10} km`;
const inWeek = (week: WeekBudget) => (session: Pick<PlannedRun, "weekStart">) =>
  session.weekStart === week.weekStart;
/** How the coach finds a session in a break: its week, then its title. */
const named = (session: PlannedRun) => `Week of ${session.weekStart}, "${session.title}"`;
const racesIn = (week: WeekBudget, ctx: RuleContext) =>
  ctx.raceWeeks.filter((weekStart) => weekStart === week.weekStart).length;

/** Days of the week from today on: 7 for a week ahead, fewer for this one. */
const daysLeft = (week: WeekBudget, today: string) =>
  Math.min(7, Math.max(0, 7 - daysBetween(week.weekStart, today)));

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
        message: `${named(session)}: every step needs exactly one of distanceM or durationS (above 0), and exactly one of pace or effort.`,
      });
    }
  }
  return breaks;
}

/** Sessions in the weeks being written only, and no race: VO2 adds races. */
export function weekBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const written = ctx.weeks.filter((week) => week.weekStart >= ctx.fromWeek);
  const open = new Set(written.map((week) => week.weekStart));
  const breaks: RuleBreak[] = [];
  for (const session of sessions) {
    if (!open.has(session.weekStart)) {
      breaks.push({
        rule: "weeks",
        message: `${named(session)}: write sessions for the weeks from ${written[0]?.weekStart} to ${written.at(-1)?.weekStart} only, with the week's Monday as weekStart.`,
      });
    } else if (session.kind === "race") {
      breaks.push({
        rule: "weeks",
        message: `${named(session)}: VO2 adds the athlete's races itself; write no race.`,
      });
    }
  }
  return breaks;
}

/**
 * Runs the athlete's availability allows in the week: their runs per week, or fewer when the week
 * is under way and has fewer days left, one run a day and none on a race's day. Sessions kept
 * because they are done count as runs.
 */
export function runsAvailable(week: WeekBudget, ctx: RuleContext) {
  const kept = ctx.frozen.filter(inWeek(week)).length;
  const open = Math.max(0, daysLeft(week, ctx.today) - racesIn(week, ctx));
  return Math.min(ctx.availability.runsPerWeek, kept + open);
}

/** No more runs in a week than the athlete's availability allows (and rule 8: one a day). */
export function availabilityBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const { runsPerWeek } = ctx.availability;
  for (const week of ctx.weeks) {
    const count = [...ctx.frozen, ...sessions].filter(inWeek(week)).length;
    const allowed = runsAvailable(week, ctx);
    if (count > allowed) {
      breaks.push({
        rule: "availability",
        message: `Week of ${week.weekStart}: ${count} runs, but ${allowed} fit: the athlete runs ${runsPerWeek} a week${allowed < runsPerWeek ? ", and this week has fewer days left" : ""}.`,
      });
    }
  }
  return breaks;
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
 * The longest a run in the week may be (rule 2): 10 % over the longest of the athlete's runs in
 * the 30 days before the week, and of the planned sessions in the four weeks before it. Sessions in
 * the same week don't count: they have no order, so none comes before another.
 */
export function longestAllowedKm(
  weekStart: string,
  ctx: Pick<RuleContext, "runs" | "today">,
  planned: Pick<PlannedRun, "weekStart" | "distanceKm" | "kind">[],
) {
  const since = addDayKey(weekStart, -LONGEST_WINDOW_DAYS);
  const sinceWeek = addDayKey(weekStart, -7 * LONGEST_WINDOW_WEEKS);
  const longest = Math.max(
    MIN_LONGEST_KM,
    ...ctx.runs.filter((run) => run.date >= since && run.date < ctx.today).map((run) => run.km),
    ...planned
      .filter(
        (session) =>
          session.kind !== "race" &&
          session.weekStart >= sinceWeek &&
          session.weekStart < weekStart,
      )
      .map((session) => session.distanceKm),
  );
  return { longest, limit: longest * MAX_RUN_GROWTH };
}

/**
 * The least a week must reach (rule 1), or null when it has no floor: a week not written in full
 * (one already under way), a race week, and a taper week can come in lower. The floor is 90 % of
 * the budget, or of what the longest-run rules allow when they hold the week lower: no run past
 * 10 % over the longest of the last 30 days nor 2 h 30, so an athlete back from a break isn't
 * asked for more than they may run. Equal runs always keep the long run's share, so the share
 * never holds the week lower.
 */
export function weekFloorKm(week: WeekBudget, ctx: RuleContext): number | null {
  if (ctx.allowShort || week.weekStart < ctx.fromWeek || week.weekStart < ctx.today) return null;
  if (week.taper || racesIn(week, ctx)) return null;
  const { limit } = longestAllowedKm(week.weekStart, ctx, []);
  const perRun = Math.min((MAX_LONG_MINUTES * 60) / ctx.easySecPerKm, limit);
  const reach = longShareRuns(week, ctx) * perRun * REACH_SHARE;
  return Math.round(Math.min(week.budgetKm, reach) * BUDGET_FLOOR * 10) / 10;
}

/**
 * Rules 1, 6, and 7: each week's distance stays inside its budget, which is lighter every fourth
 * week and in the taper. Sessions kept because they are done count, so a missed run's distance
 * can't be added to the others (rule 8).
 */
export function budgetBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const week of ctx.weeks) {
    // Sessions kept alone may already pass the budget; then the coach's part is to add nothing.
    if (!sessions.some(inWeek(week))) continue;
    const total = [...ctx.frozen, ...sessions]
      .filter(inWeek(week))
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

/** Rule 2: no run more than 10 % longer than the longest of the 30 days before its week. */
export function spikeBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const planned = [...ctx.frozen, ...ctx.neighbours, ...sessions];
  for (const session of sessions) {
    const { longest, limit } = longestAllowedKm(session.weekStart, ctx, planned);
    if (session.distanceKm > limit + 0.05) {
      breaks.push({
        rule: "2. longest run",
        message: `${named(session)}: ${km(session.distanceKm)}, but the longest run in the 30 days before its week is ${km(longest)}, so ${km(limit)} at most.`,
      });
    }
  }
  return breaks;
}

/** Rule 4 per week, and rule 5: the long run's share of the week and its time. */
export function weekShapeBreaks(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const { runsPerWeek } = ctx.availability;
  const maxQuality = maxQualitySessions(runsPerWeek);
  for (const week of ctx.weeks) {
    const runs = [...ctx.frozen, ...sessions].filter(inWeek(week));
    const races = racesIn(week, ctx);
    const quality = runs.filter((session) => isQualityKind(session.kind)).length + races;
    if (quality > maxQuality) {
      breaks.push({
        rule: "4. quality sessions",
        message: `Week of ${week.weekStart}: ${quality} quality sessions${races ? " (races count)" : ""}, at most ${maxQuality} with ${runsPerWeek} runs a week.`,
      });
    }
    const total = runs.reduce((sum, session) => sum + session.distanceKm, 0);
    if (runs.filter((session) => isLongKind(session.kind)).length > 1) {
      breaks.push({
        rule: "5. long run",
        message: `Week of ${week.weekStart}: one long run a week.`,
      });
    }
    // The week's longest run counts whatever it is called, so a long run can't pass as easy.
    const longest = [...runs].sort((a, b) => b.distanceKm - a.distanceKm)[0];
    // A plan change reads the share by the runs left in the week, so dropping a run for an absence
    // isn't refused for leaving the others equal; a long run that dominates still breaks it, and
    // one that grows is held to the usual share (ADR 0038).
    const loose =
      ctx.allowShort &&
      longest != null &&
      longest.distanceKm <= (ctx.longestBefore?.[week.weekStart] ?? 0) + 0.05;
    const counted = loose
      ? Math.max(1, Math.min(longShareRuns(week, ctx), runs.length))
      : longShareRuns(week, ctx);
    const longShare = maxLongShare(counted);
    if (longest && sessions.includes(longest)) {
      if (longest.distanceKm > total * longShare + 0.05) {
        breaks.push({
          rule: "5. long run",
          message: `${named(longest)}: the week's longest run is ${km(longest.distanceKm)} of a ${km(total)} week, over ${Math.round(longShare * 100)} % for ${counted} runs a week.`,
        });
      }
    }
    for (const run of runs.filter((item) => sessions.includes(item))) {
      if ((run === longest || isLongKind(run.kind)) && run.minutes > MAX_LONG_MINUTES) {
        breaks.push({
          rule: "5. long run",
          message: `${named(run)}: the long run takes about ${run.minutes} min, over 2 h 30.`,
        });
      }
    }
  }
  return breaks;
}

/** Every rule the plan's new sessions break; empty when it passes. */
export function checkPlan(sessions: PlannedRun[], ctx: RuleContext): RuleBreak[] {
  return [
    ...formatBreaks(sessions),
    ...weekBreaks(sessions, ctx),
    ...availabilityBreaks(sessions, ctx),
    ...budgetBreaks(sessions, ctx),
    ...spikeBreaks(sessions, ctx),
    ...weekShapeBreaks(sessions, ctx),
  ];
}
