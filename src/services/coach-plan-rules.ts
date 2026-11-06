import {
  budgetOf,
  isLongKind,
  isQualityKind,
  kindFitsSport,
  metresText,
  minutesText,
  PLAN_SPORTS,
  planSportOf,
  plannedSports,
  sessionKindLabel,
  sessionsPerWeek,
  type Availability,
  type PlanSport,
  type PlannedSession,
  type Step,
  sessionAmount,
  swimZoneOf,
  DRILLS,
  drillOf,
} from "./coach-plan.types.ts";
import type { SportDay, WeekBudget } from "./coach-plan-budget.ts";
import { addDayKey } from "./day-key.ts";
import { mondayOf } from "./season-phase.ts";
import { daysBetween, type Goal, type GoalEffort } from "./season.types.ts";
import { formatPaceClock } from "./locomotion.ts";
import type { PaceRange, PaceType } from "./training-paces.types.ts";

/*
 * The rules of ADR 0037 and ADR 0050, checked in code on every plan the coach writes. Each check
 * is a pure function of the plan and what VO2 knows, returning the rules it breaks in words the
 * coach can act on. A plan that breaks any goes back to the coach (coach-plan.server.ts). Sessions
 * have no day (ADR 0048), so every rule reads them by week, and none is about neighbouring days.
 * Runs and swims are sized by distance, rides by time; each sport is checked on its own, and the
 * week's quality sessions across all of them (ADR 0061).
 */

export type RuleBreak = { rule: string; message: string };

/**
 * An upcoming goal in the weeks written: VO2 adds the race itself. Its effort is "perform" for a
 * main goal, else the supporting race's (ADR 0052).
 */
export type RaceWeek = { weekStart: string; date: string; sport: PlanSport; effort: RaceEffort };
export type RaceEffort = "perform" | GoalEffort;

/** The run, ride, and swim goals from `fromWeek` through `lastDay`, as the rules read them. */
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
        date: goal.date,
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
  /** The athlete's runs, rides, and swims before today, for the longest of the last 30 days. */
  runs: SportDay[];
  rides: SportDay[];
  swims: SportDay[];
  /** The week and sport of each upcoming run, ride, or swim goal in the weeks written. */
  races: RaceWeek[];
  /**
   * Planned sessions of this week on outside the weeks being written, such as the weeks kept when
   * only a new week is added. They count toward the longest-session limit of the weeks after
   * them, but toward no week being written.
   */
  neighbours: PlannedSession[];
  /** Seconds per km at the middle of easy pace, to size a 2 h 30 run for the floor. */
  easySecPerKm: number;
  /** Seconds per 100 m at the middle of the endurance swim zone, to size a 2 h swim. */
  easySecPer100m: number;
  /** The athlete's training paces; null without running history, when runs go by effort. */
  paces: Record<PaceType, PaceRange> | null;
  /** Each upcoming run goal's predicted race pace in seconds per km, for race-pace steps. */
  racePaces: number[];
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
/** The long swim is at most 2 h (rule 5), longer than any age-group event's swim leg. */
export const MAX_LONG_SWIM_MINUTES = 120;
/** At most this many quality sessions a week across runs, rides, and swims (rule 4). */
export const MAX_QUALITY_ACROSS_SPORTS = 3;

/** Quality sessions a week per sport (rule 4): 1 for 2–3 sessions, 2 for 4–5, at most 3 for 6. */
export function maxQualitySessions(perWeek: number) {
  return perWeek <= 3 ? 1 : perWeek <= 5 ? 2 : 3;
}

/**
 * The long run's largest share of the week (rule 5), by the runs the athlete's availability
 * allows that week: at most twice the average of the week's other runs, so 2 / (runs + 1), and
 * never under Daniels' 30 % (ADR 0053). That is 67 % for 2 runs, 50 % for 3, 40 % for 4, 33 % for
 * 5, and 30 % from 6. The 10 % rule on the longest run still sets how fast it grows. A week of one
 * run has no share to keep.
 */
export function maxLongShare(runsInWeek: number) {
  if (runsInWeek <= 1) return 1;
  return Math.max(0.3, 2 / (runsInWeek + 1));
}

/**
 * The long ride's (and the long swim's) largest share of the week (rule 5): about 40 %, more with
 * fewer sessions, where even equal ones take a bigger share (`coaching/cycling.md`,
 * `coaching/swimming.md`).
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
  swim: {
    noun: "swim",
    plural: "swims",
    amount: (session: Pick<PlannedSession, "distanceKm" | "minutes">) =>
      sessionAmount({ ...session, sport: "swim" }),
    dayAmount: (day: SportDay) => day.km * 1000,
    text: metresText,
    // Swims carry no impact either: 15 % on the longest of the last 30 days (`coaching/swimming.md`).
    growth: 1.15,
    minLongest: 2000,
    maxLongMinutes: MAX_LONG_SWIM_MINUTES,
    minSession: 1000,
    longShare: maxLongRideShare,
  },
} as const satisfies Record<PlanSport, unknown>;

const historyOf = (ctx: Pick<RuleContext, "runs" | "rides" | "swims">, sport: PlanSport) =>
  sport === "run" ? ctx.runs : sport === "ride" ? ctx.rides : ctx.swims;
/** The longest session's time cap in the sport's unit, at its easy pace. */
const timeCapOf = (sport: PlanSport, ctx: Pick<RuleContext, "easySecPerKm" | "easySecPer100m">) => {
  const seconds = SPORT_RULES[sport].maxLongMinutes * 60;
  if (sport === "run") return seconds / ctx.easySecPerKm;
  if (sport === "swim") return (seconds / ctx.easySecPer100m) * 100;
  return SPORT_RULES[sport].maxLongMinutes;
};
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
/**
 * Quality races toward the cap across sports: a multisport event's legs, raced on one day, are one
 * race, or a triathlon alone would fill the week's three.
 */
const qualityEventsIn = (week: WeekBudget, ctx: RuleContext) =>
  new Set(
    racesOf(week, ctx)
      .filter((race) => race.effort !== "fun")
      .map((race) => race.date),
  ).size;
const sumOf = (sessions: PlannedSession[], sport: PlanSport) =>
  sessions.reduce((sum, session) => sum + SPORT_RULES[sport].amount(session), 0);

/** Days of the week from today on: 7 for a week ahead, fewer for this one. */
const daysLeft = (week: WeekBudget, today: string) =>
  Math.min(7, Math.max(0, 7 - daysBetween(week.weekStart, today)));

/** A run step's own pace may sit this far outside its range or a race pace, for rounding. */
const PACE_SLACK_SEC = 2;

/**
 * Why a run step's own pace is wrong, or null: a step at a pace harder than easy names one pace
 * inside its pace type's range or at a goal's race pace, and every other step names none
 * (ADR 0055).
 */
function paceIssue(step: Step, ctx: Pick<RuleContext, "paces" | "racePaces">) {
  const paces = ctx.paces;
  if (paces == null || step.pace == null || step.pace === "easy") {
    return step.secPerKm == null
      ? null
      : "only a step at marathon, threshold, interval, or repetition pace has a secPerKm; easy, effort, and walk steps have it null";
  }
  if (step.secPerKm == null) {
    return `a step at ${step.pace} pace needs secPerKm: one pace in seconds per km`;
  }
  const range = paces[step.pace];
  const inRange =
    step.secPerKm >= range.fastSecPerKm - PACE_SLACK_SEC &&
    step.secPerKm <= range.slowSecPerKm + PACE_SLACK_SEC;
  const atRace = ctx.racePaces.some(
    (target) => Math.abs(step.secPerKm! - target) <= PACE_SLACK_SEC,
  );
  if (inRange || atRace) return null;
  const races = ctx.racePaces.length ? ctx.racePaces.join(", ") : "none";
  return `secPerKm ${step.secPerKm} (${formatPaceClock(step.secPerKm)} /km) is outside ${step.pace} pace, ${range.fastSecPerKm}–${range.slowSecPerKm}, and at no race pace (${races})`;
}

function stepIssue(sport: PlanSport, step: Step) {
  const amount = step.distanceM ?? step.durationS ?? 0;
  if (sport === "swim") {
    // A distance, or rest at the wall: a recovery step by time.
    const rest = step.distanceM == null && step.part === "recovery";
    return (
      (rest ? step.durationS == null : step.durationS != null || step.distanceM == null) ||
      step.pace != null ||
      step.secPerKm != null ||
      (step.zone == null) === (step.effort == null) ||
      (step.zone != null && swimZoneOf(step.zone) == null) ||
      step.effort === "walk" ||
      amount <= 0
    );
  }
  if (sport === "ride") {
    return (
      step.durationS == null ||
      step.distanceM != null ||
      step.pace != null ||
      step.secPerKm != null ||
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

const STEP_FORMAT: Record<PlanSport, (name: string) => string> = {
  run: (name) =>
    `${name}: every run step needs exactly one of distanceM or durationS (above 0), and exactly one of pace or effort, with zone null.`,
  ride: (name) =>
    `${name}: every ride step needs durationS (above 0) and no distanceM, and exactly one of zone or effort, with pace and secPerKm null.`,
  swim: (name) =>
    `${name}: every swim step needs distanceM (above 0) and no durationS, except rest at the wall: a recovery step with durationS and no distanceM. Each has exactly one of zone (recovery, endurance, tempo, threshold, vo2max, or sprint) or effort (not walk), with pace and secPerKm null.`,
};

/**
 * Why a step's drill is wrong, or null: a drill is one of the session's sport's drills, on a step
 * with a distance, at an easy effort or the recovery zone (ADR 0062).
 */
function drillIssue(sport: PlanSport, step: Step) {
  if (step.drill == null) return null;
  const drills = DRILLS.filter((drill) => drill.sport === sport).map((drill) => drill.id);
  if (drillOf(step.drill)?.sport !== sport) {
    return drills.length
      ? `drill ${step.drill} is not a ${SPORT_RULES[sport].noun} drill; use one of ${drills.join(", ")}, or null`
      : `a ${SPORT_RULES[sport].noun} step has drill null; drills are for swims`;
  }
  if (step.distanceM == null) return "rest at the wall has drill null";
  if (step.effort !== "easy" && step.zone !== "recovery") {
    return `a ${step.drill} drill step is swum at effort easy or zone recovery`;
  }
  return null;
}

/**
 * Steps that read as one thing, drills of the session's sport, run paces that fit, and a kind
 * written for the session's sport.
 */
export function formatBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const session of sessions) {
    if (!kindFitsSport(session.kind, session.sport)) {
      breaks.push({
        rule: "format",
        message: `${named(session)}: kind ${session.kind} is not written for a ${SPORT_RULES[session.sport].noun}.`,
      });
    }
    const steps = session.blocks.flatMap((block) => block.steps);
    if (steps.some((step) => stepIssue(session.sport, step))) {
      breaks.push({
        rule: "format",
        message: STEP_FORMAT[session.sport](named(session)),
      });
    }
    const drill = steps.map((step) => drillIssue(session.sport, step)).find((item) => item);
    if (drill) breaks.push({ rule: "format", message: `${named(session)}: ${drill}.` });
    if (session.sport !== "run") continue;
    const issue = steps.map((step) => paceIssue(step, ctx)).find((item) => item != null);
    if (issue) {
      breaks.push({ rule: "format", message: `${named(session)}: ${issue}.` });
    }
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

/**
 * What the coach has left to write of a sport in a week: the sessions available and the budget,
 * less the sessions done. The checker counts kept sessions toward their
 * week, so a coach given the totals writes a full week on top of them.
 */
export function leftToWrite(week: WeekBudget, ctx: RuleContext, sport: PlanSport) {
  const kept = ctx.frozen.filter(inWeek(week, sport));
  const budget = Math.max(0, Math.round((budgetOf(week, sport) - sumOf(kept, sport)) * 10) / 10);
  // Kept sessions that already fill the budget leave nothing to write, whatever days are left.
  const sessions = budget > 0 ? sessionsAvailable(week, ctx, sport) - kept.length : 0;
  return { sessions: Math.max(0, sessions), budget };
}

/** No more sessions of a sport in a week than the athlete's availability allows. */
export function availabilityBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const { id: sport } of PLAN_SPORTS) {
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
 * the budget holds at the shortest session VO2 asks for (3 km, 45 minutes, 1,000 m), so a small taper or
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
 * over the longest ride or swim) of the 30 days before the week, and of the planned sessions in the four
 * weeks before it. Sessions in the same week don't count: they have no order, so none comes
 * before another.
 */
export function longestAllowed(
  weekStart: string,
  sport: PlanSport,
  ctx: Pick<RuleContext, "runs" | "rides" | "swims" | "today">,
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
  const { limit } = longestAllowed(week.weekStart, sport, ctx, []);
  const timeCap = timeCapOf(sport, ctx);
  const reach = longShareCount(week, ctx, sport) * Math.min(timeCap, limit) * REACH_SHARE;
  return Math.round(Math.min(budgetOf(week, sport), reach) * BUDGET_FLOOR * 10) / 10;
}

/**
 * Rules 1, 6, and 7, per sport: each week's distance of running and swimming and time of riding stays inside
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
 * Rule 4 per sport and across all of them, and rule 5 per sport: the long session's share of the week
 * and its time. A race counts as a quality session unless it is run for fun, and a steady
 * supporting race keeps its sport's other sessions that week easy (ADR 0052).
 */
export function weekShapeBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const sports = plannedSports(ctx.availability);
  for (const week of ctx.weeks) {
    const all = [...ctx.frozen, ...sessions].filter(inWeek(week));
    const allQuality =
      all.filter((session) => isQualityKind(session.kind)).length + qualityEventsIn(week, ctx);
    // Sessions kept alone may already pass the cap; then the coach's part is to add nothing.
    const wrote = sessions.some(inWeek(week));
    if (sports.length > 1 && wrote && allQuality > MAX_QUALITY_ACROSS_SPORTS) {
      breaks.push({
        rule: "4. quality sessions",
        message: `Week of ${week.weekStart}: ${allQuality} quality sessions across sports (races count), at most ${MAX_QUALITY_ACROSS_SPORTS}.`,
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
    ...formatBreaks(sessions, ctx),
    ...weekBreaks(sessions, ctx),
    ...availabilityBreaks(sessions, ctx),
    ...budgetBreaks(sessions, ctx),
    ...spikeBreaks(sessions, ctx),
    ...weekShapeBreaks(sessions, ctx),
  ];
}
