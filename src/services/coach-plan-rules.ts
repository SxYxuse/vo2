import {
  isLongKind,
  isQualityKind,
  kindFitsSport,
  minutesText,
  planSportOf,
  plannedSports,
  sessionKindLabel,
  sessionsPerWeek,
  type Availability,
  type PlanSport,
  type PlannedSession,
} from "./coach-plan.types.ts";
import type { SportDay, WeekBudget } from "./coach-plan-budget.ts";
import { addDayKey } from "./day-key.ts";
import { mondayOf } from "./season-phase.ts";
import { daysBetween, type Goal, type GoalEffort } from "./season.types.ts";

/*
 * The rules of ADR 0037 and ADR 0050, checked in code on every plan the coach writes. Each check
 * is a pure function of the plan and what VO2 knows, returning the rules it breaks in words the
 * coach can act on. A plan that breaks any goes back to the coach (coach-plan.server.ts). Sessions
 * have no day (ADR 0048), so every rule reads them by week, and none is about neighbouring days.
 * Runs are sized by distance, rides by time; each sport is checked on its own, and the week's
 * quality sessions across both.
 */

export type RuleBreak = { rule: string; message: string };

/**
 * An upcoming goal in the weeks written: VO2 adds the race itself. Its effort is "perform" for a
 * main goal, else the supporting race's (ADR 0052).
 */
export type RaceWeek = { weekStart: string; sport: PlanSport; effort: RaceEffort };
export type RaceEffort = "perform" | GoalEffort;

/** The run and ride goals from `fromWeek` through `lastDay`, as the rules read them. */
export function raceWeeks(goals: Goal[], fromWeek: string, lastDay: string) {
  return goals
    .filter(
      (goal) =>
        planSportOf(goal.sportType) != null &&
        goal.distanceM != null &&
        goal.date >= fromWeek &&
        goal.date <= lastDay,
    )
    .map((goal) => ({
      goal,
      race: {
        weekStart: mondayOf(goal.date),
        sport: planSportOf(goal.sportType)!,
        effort: goal.priority === "A" ? "perform" : (goal.effort ?? "steady"),
      } satisfies RaceWeek,
    }));
}

export type RuleContext = {
  availability: Availability;
  weeks: WeekBudget[];
  /** The first week written; weeks before it are kept as they are. */
  fromWeek: string;
  today: string;
  /** Sessions kept in the weeks being written: the ones the athlete marked done. */
  frozen: PlannedSession[];
  /** The athlete's runs and rides before today, for the longest of the last 30 days. */
  runs: SportDay[];
  rides: SportDay[];
  /** The week and sport of each upcoming run or ride goal in the weeks written. */
  races: RaceWeek[];
  /**
   * Planned sessions of this week on outside the weeks being written, such as the weeks kept when
   * only a new week is added. They count toward the longest-session limit of the weeks after
   * them, but toward no week being written.
   */
  neighbours: PlannedSession[];
  /** Seconds per km at the middle of easy pace, to size a 2 h 30 run for the floor. */
  easySecPerKm: number;
  /**
   * Set when checking a plan change (ADR 0038): a week may then end under its floor, since an
   * athlete who is ill or away trains less, and less training breaks no safety rule, and the
   * longest session's share is read by the sessions left in the week, as long as the week's
   * longest doesn't grow past `longestBefore`.
   */
  allowShort?: true;
  /** For a plan change: each week's longest session before it, by sport and week start. */
  longestBefore?: Partial<Record<PlanSport, Record<string, number>>>;
};

/** A week may come in this much over its budget, for rounding. */
const BUDGET_TOLERANCE = 1.05;
/**
 * A full week must reach this share of its budget: the coaching knowledge asks for 95–100 %, and
 * the gap leaves room for rounding. The longest-session rules may hold a week lower; see
 * weekFloor.
 */
const BUDGET_FLOOR = 0.9;
/** What the longest-session rules allow is estimated, so only this much counts. */
const REACH_SHARE = 0.85;
const LONGEST_WINDOW_DAYS = 30;
/** Planned weeks read for rule 2: the four before a session's week. */
const LONGEST_WINDOW_WEEKS = 4;
/** The long run is at most 2 h 30 (rule 5). */
export const MAX_LONG_MINUTES = 150;
/** The long ride is at most 6 h (rule 5): beyond it recovery costs more than it builds. */
export const MAX_LONG_RIDE_MINUTES = 360;
/** At most this many quality sessions a week across runs and rides (rule 4). */
export const MAX_QUALITY_ACROSS_SPORTS = 3;

/** Quality sessions a week per sport (rule 4): 1 for 2–3 sessions, 2 for 4–5, at most 3 for 6. */
export function maxQualitySessions(perWeek: number) {
  return perWeek <= 3 ? 1 : perWeek <= 5 ? 2 : 3;
}

/**
 * The long run's largest share of the week (rule 5), by the runs the athlete's availability
 * allows that week. It is 30 %. With two or three runs even equal runs are half or a third of the
 * week, so those weeks allow 50 % and 40 % (ADR 0040). A week of one run has no share to keep.
 */
export function maxLongShare(runsInWeek: number) {
  if (runsInWeek <= 1) return 1;
  return runsInWeek === 2 ? 0.5 : runsInWeek === 3 ? 0.4 : 0.3;
}

/**
 * The long ride's largest share of the week's riding (rule 5): about 40 %, more with fewer rides,
 * where even equal rides take a bigger share (`cycling/principles.md`).
 */
export function maxLongRideShare(ridesInWeek: number) {
  if (ridesInWeek <= 1) return 1;
  return ridesInWeek === 2 ? 0.6 : ridesInWeek === 3 ? 0.5 : 0.4;
}

/** How each sport's sessions are sized and limited. */
const SPORT_RULES = {
  run: {
    noun: "run",
    plural: "runs",
    amount: (session: Pick<PlannedSession, "distanceKm" | "minutes">) => session.distanceKm,
    dayAmount: (day: SportDay) => day.km,
    text: (km: number) => `${Math.round(km * 10) / 10} km`,
    /** Rule 2: at most 10 % longer than the longest of the last 30 days. */
    growth: 1.1,
    /** With nothing in the last 30 days, sessions up to this long still pass rule 2. */
    minLongest: 5,
    maxLongMinutes: MAX_LONG_MINUTES,
    /** VO2 asks for no session under this. */
    minSession: 3,
    longShare: maxLongShare,
  },
  ride: {
    noun: "ride",
    plural: "rides",
    amount: (session: Pick<PlannedSession, "distanceKm" | "minutes">) => session.minutes,
    dayAmount: (day: SportDay) => day.minutes,
    text: (minutes: number) => minutesText(Math.round(minutes)),
    // Rides carry no impact, so they may grow more: 15 % on the longest of the last 30 days.
    growth: 1.15,
    minLongest: 90,
    maxLongMinutes: MAX_LONG_RIDE_MINUTES,
    minSession: 45,
    longShare: maxLongRideShare,
  },
} as const;

const budgetOf = (week: WeekBudget, sport: PlanSport) =>
  sport === "run" ? week.budgetKm : week.budgetMinutes;
const historyOf = (ctx: Pick<RuleContext, "runs" | "rides">, sport: PlanSport) =>
  sport === "run" ? ctx.runs : ctx.rides;
const inWeek =
  (week: Pick<WeekBudget, "weekStart">, sport?: PlanSport) =>
  (session: Pick<PlannedSession, "weekStart" | "sport">) =>
    session.weekStart === week.weekStart && (sport == null || session.sport === sport);
/** How the coach finds a session in a break: its week, then its title. */
const named = (session: PlannedSession) => `Week of ${session.weekStart}, "${session.title}"`;
const racesOf = (week: WeekBudget, ctx: RuleContext, sport?: PlanSport) =>
  ctx.races.filter(
    (race) => race.weekStart === week.weekStart && (sport == null || race.sport === sport),
  );
const racesIn = (week: WeekBudget, ctx: RuleContext, sport?: PlanSport) =>
  racesOf(week, ctx, sport).length;
/** Races that count as a quality session (rule 4): every race but one run for fun. */
const qualityRacesIn = (week: WeekBudget, ctx: RuleContext, sport?: PlanSport) =>
  racesOf(week, ctx, sport).filter((race) => race.effort !== "fun").length;
const sumOf = (sessions: PlannedSession[], sport: PlanSport) =>
  sessions.reduce((sum, session) => sum + SPORT_RULES[sport].amount(session), 0);

/** Days of the week from today on: 7 for a week ahead, fewer for this one. */
const daysLeft = (week: WeekBudget, today: string) =>
  Math.min(7, Math.max(0, 7 - daysBetween(week.weekStart, today)));

function stepIssue(sport: PlanSport, step: PlannedSession["blocks"][number]["steps"][number]) {
  const amount = step.distanceM ?? step.durationS ?? 0;
  if (sport === "ride") {
    return (
      step.durationS == null ||
      step.distanceM != null ||
      step.pace != null ||
      (step.zone == null) === (step.effort == null) ||
      amount <= 0
    );
  }
  return (
    (step.distanceM == null) === (step.durationS == null) ||
    step.zone != null ||
    (step.pace == null) === (step.effort == null) ||
    amount <= 0
  );
}

/** Steps that read as one thing, and a kind written for the session's sport. */
export function formatBreaks(sessions: PlannedSession[]): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const session of sessions) {
    if (!kindFitsSport(session.kind, session.sport)) {
      breaks.push({
        rule: "format",
        message: `${named(session)}: kind ${session.kind} is not written for a ${SPORT_RULES[session.sport].noun}.`,
      });
    }
    const bad = session.blocks.some((block) =>
      block.steps.some((step) => stepIssue(session.sport, step)),
    );
    if (!bad) continue;
    breaks.push({
      rule: "format",
      message:
        session.sport === "ride"
          ? `${named(session)}: every ride step needs durationS (above 0) and no distanceM, and exactly one of zone or effort, with pace null.`
          : `${named(session)}: every run step needs exactly one of distanceM or durationS (above 0), and exactly one of pace or effort, with zone null.`,
    });
  }
  return breaks;
}

/** Sessions in the weeks being written only, for a planned sport, and no race: VO2 adds races. */
export function weekBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
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
 * Sessions of one sport the athlete's availability allows in the week: their sessions per week,
 * or fewer when the week is under way and has fewer days left, one of each sport a day and none
 * on that sport's race day, and one fewer for each race run for fun. Sessions kept because they
 * are done count.
 */
export function sessionsAvailable(week: WeekBudget, ctx: RuleContext, sport: PlanSport) {
  const kept = ctx.frozen.filter(inWeek(week, sport)).length;
  const open = Math.max(0, daysLeft(week, ctx.today) - racesIn(week, ctx, sport));
  // A race run for fun is the week's easy session, so one fewer is written (ADR 0052).
  const fun = racesIn(week, ctx, sport) - qualityRacesIn(week, ctx, sport);
  return Math.max(0, Math.min(sessionsPerWeek(ctx.availability, sport) - fun, kept + open));
}

/** No more sessions of a sport in a week than the athlete's availability allows. */
export function availabilityBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const sport of ["run", "ride"] as const) {
    const perWeek = sessionsPerWeek(ctx.availability, sport);
    const { plural } = SPORT_RULES[sport];
    for (const week of ctx.weeks) {
      const count = [...ctx.frozen, ...sessions].filter(inWeek(week, sport)).length;
      const allowed = sessionsAvailable(week, ctx, sport);
      if (count <= allowed) continue;
      breaks.push({
        rule: "availability",
        message:
          perWeek === 0
            ? `Week of ${week.weekStart}: ${count} ${plural}, but the athlete plans no ${plural}.`
            : `Week of ${week.weekStart}: ${count} ${plural}, but ${allowed} fit: the athlete does ${perWeek} a week${allowed < perWeek ? ", and this week has fewer days left" : ""}.`,
      });
    }
  }
  return breaks;
}

/**
 * The sessions the longest session's share is read for: the sessions available, but no more than
 * the budget holds at the shortest session VO2 asks for (3 km, 45 minutes), so a small taper or
 * recovery week isn't asked for tiny sessions.
 */
export function longShareCount(week: WeekBudget, ctx: RuleContext, sport: PlanSport) {
  return Math.max(
    1,
    Math.min(
      sessionsAvailable(week, ctx, sport),
      Math.floor(budgetOf(week, sport) / SPORT_RULES[sport].minSession),
    ),
  );
}

/**
 * The longest a session of the sport may be in the week (rule 2): 10 % over the longest run (15 %
 * over the longest ride) of the 30 days before the week, and of the planned sessions in the four
 * weeks before it. Sessions in the same week don't count: they have no order, so none comes
 * before another.
 */
export function longestAllowed(
  weekStart: string,
  sport: PlanSport,
  ctx: Pick<RuleContext, "runs" | "rides" | "today">,
  planned: Pick<PlannedSession, "weekStart" | "distanceKm" | "minutes" | "kind" | "sport">[],
) {
  const rules = SPORT_RULES[sport];
  const since = addDayKey(weekStart, -LONGEST_WINDOW_DAYS);
  const sinceWeek = addDayKey(weekStart, -7 * LONGEST_WINDOW_WEEKS);
  const longest = Math.max(
    rules.minLongest,
    ...historyOf(ctx, sport)
      .filter((day) => day.date >= since && day.date < ctx.today)
      .map(rules.dayAmount),
    ...planned
      .filter(
        (session) =>
          session.sport === sport &&
          session.kind !== "race" &&
          session.weekStart >= sinceWeek &&
          session.weekStart < weekStart,
      )
      .map(rules.amount),
  );
  return { longest, limit: longest * rules.growth };
}

/**
 * The least a sport's week must reach (rule 1), or null when it has no floor: a week not written
 * in full (one already under way), a race week, and a taper week can come in lower. The floor is
 * 90 % of the budget, or of what the longest-session rules allow when they hold the week lower:
 * no session past rule 2 nor the long session's time, so an athlete back from a break isn't asked
 * for more than they may do. Equal sessions always keep the long session's share, so the share
 * never holds the week lower.
 */
export function weekFloor(week: WeekBudget, ctx: RuleContext, sport: PlanSport): number | null {
  if (ctx.allowShort || week.weekStart < ctx.fromWeek || week.weekStart < ctx.today) return null;
  if (week.taper || racesIn(week, ctx)) return null;
  const rules = SPORT_RULES[sport];
  const { limit } = longestAllowed(week.weekStart, sport, ctx, []);
  const timeCap =
    sport === "run" ? (rules.maxLongMinutes * 60) / ctx.easySecPerKm : rules.maxLongMinutes;
  const reach = longShareCount(week, ctx, sport) * Math.min(timeCap, limit) * REACH_SHARE;
  return Math.round(Math.min(budgetOf(week, sport), reach) * BUDGET_FLOOR * 10) / 10;
}

/**
 * Rules 1, 6, and 7, per sport: each week's distance of running and time of riding stays inside
 * its budget, which is lighter every fourth week and in the taper. Sessions kept because they are
 * done count, so a missed session can't be added to the others (rule 8).
 */
export function budgetBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const sport of plannedSports(ctx.availability)) {
    const { text, plural } = SPORT_RULES[sport];
    for (const week of ctx.weeks) {
      // Sessions kept alone may already pass the budget; then the coach's part is to add nothing.
      if (!sessions.some(inWeek(week, sport))) continue;
      const total = sumOf([...ctx.frozen, ...sessions].filter(inWeek(week, sport)), sport);
      const budget = budgetOf(week, sport);
      const floor = weekFloor(week, ctx, sport);
      if (floor != null && total < floor) {
        breaks.push({
          rule: "1. weekly budget",
          message: `Week of ${week.weekStart} has ${text(total)} of ${plural}, under ${text(floor)}: plan 95–100 % of its ${text(budget)} budget.`,
        });
        continue;
      }
      if (total <= budget * BUDGET_TOLERANCE) continue;
      const rule = week.taper ? "7. taper" : week.lighter ? "6. lighter week" : "1. weekly budget";
      const kind = week.taper ? "a taper week" : week.lighter ? "a lighter week" : "budgeted";
      breaks.push({
        rule,
        message: `Week of ${week.weekStart} is ${kind} at ${text(budget)} of ${plural}, but the plan has ${text(total)}.`,
      });
    }
  }
  return breaks;
}

/** Rule 2: no session much longer than the longest of its sport in the 30 days before its week. */
export function spikeBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const planned = [...ctx.frozen, ...ctx.neighbours, ...sessions];
  for (const session of sessions) {
    const rules = SPORT_RULES[session.sport];
    const { longest, limit } = longestAllowed(session.weekStart, session.sport, ctx, planned);
    if (rules.amount(session) > limit + 0.05) {
      breaks.push({
        rule: "2. longest session",
        message: `${named(session)}: ${rules.text(rules.amount(session))}, but the longest ${rules.noun} in the 30 days before its week is ${rules.text(longest)}, so ${rules.text(limit)} at most.`,
      });
    }
  }
  return breaks;
}

/**
 * Rule 4 per sport and across both, and rule 5 per sport: the long session's share of the week
 * and its time. A race counts as a quality session unless it is run for fun, and a steady
 * supporting race keeps its sport's other sessions that week easy (ADR 0052).
 */
export function weekShapeBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const sports = plannedSports(ctx.availability);
  for (const week of ctx.weeks) {
    const all = [...ctx.frozen, ...sessions].filter(inWeek(week));
    const allQuality =
      all.filter((session) => isQualityKind(session.kind)).length + qualityRacesIn(week, ctx);
    if (sports.length > 1 && allQuality > MAX_QUALITY_ACROSS_SPORTS) {
      breaks.push({
        rule: "4. quality sessions",
        message: `Week of ${week.weekStart}: ${allQuality} quality sessions across runs and rides (races count), at most ${MAX_QUALITY_ACROSS_SPORTS}.`,
      });
    }
    for (const sport of sports) {
      const rules = SPORT_RULES[sport];
      const perWeek = sessionsPerWeek(ctx.availability, sport);
      const mine = all.filter((session) => session.sport === sport);
      const races = qualityRacesIn(week, ctx, sport);
      const written = mine.filter((session) => isQualityKind(session.kind));
      const quality = written.length + races;
      const maxQuality = maxQualitySessions(perWeek);
      const steady = racesOf(week, ctx, sport).some((race) => race.effort === "steady");
      if (steady && written.length) {
        breaks.push({
          rule: "4. quality sessions",
          message: `Week of ${week.weekStart}: a steady ${rules.noun} race keeps the week's other ${rules.plural} easy, but it has ${written.length} quality ${written.length === 1 ? rules.noun : rules.plural}.`,
        });
      } else if (quality > maxQuality) {
        breaks.push({
          rule: "4. quality sessions",
          message: `Week of ${week.weekStart}: ${quality} quality ${rules.plural}${races ? " (races count)" : ""}, at most ${maxQuality} with ${perWeek} ${rules.plural} a week.`,
        });
      }
      if (mine.filter((session) => isLongKind(session.kind)).length > 1) {
        breaks.push({
          rule: "5. long session",
          message: `Week of ${week.weekStart}: one ${sessionKindLabel("long", sport).toLowerCase()} a week.`,
        });
      }
      const total = sumOf(mine, sport);
      // The week's longest counts whatever it is called, so a long session can't pass as easy.
      const longest = [...mine].sort((a, b) => rules.amount(b) - rules.amount(a))[0];
      // A plan change reads the share by the sessions left in the week, so dropping one for an
      // absence isn't refused for leaving the others equal; a long one that dominates still breaks
      // it, and one that grows is held to the usual share (ADR 0038).
      const loose =
        ctx.allowShort &&
        longest != null &&
        rules.amount(longest) <= (ctx.longestBefore?.[sport]?.[week.weekStart] ?? 0) + 0.05;
      const counted = loose
        ? Math.max(1, Math.min(longShareCount(week, ctx, sport), mine.length))
        : longShareCount(week, ctx, sport);
      const share = rules.longShare(counted);
      if (longest && sessions.includes(longest) && rules.amount(longest) > total * share + 0.05) {
        breaks.push({
          rule: "5. long session",
          message: `${named(longest)}: the week's longest ${rules.noun} is ${rules.text(rules.amount(longest))} of ${rules.text(total)}, over ${Math.round(share * 100)} % for ${counted} ${rules.plural} a week.`,
        });
      }
      for (const session of mine.filter((item) => sessions.includes(item))) {
        if (
          (session === longest || isLongKind(session.kind)) &&
          session.minutes > rules.maxLongMinutes
        ) {
          breaks.push({
            rule: "5. long session",
            message: `${named(session)}: it takes about ${minutesText(session.minutes)}, over ${minutesText(rules.maxLongMinutes)}.`,
          });
        }
      }
    }
  }
  return breaks;
}

/** Every rule the plan's new sessions break; empty when it passes. */
export function checkPlan(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  return [
    ...formatBreaks(sessions),
    ...weekBreaks(sessions, ctx),
    ...availabilityBreaks(sessions, ctx),
    ...budgetBreaks(sessions, ctx),
    ...spikeBreaks(sessions, ctx),
    ...weekShapeBreaks(sessions, ctx),
  ];
}
