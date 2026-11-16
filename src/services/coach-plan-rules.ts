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

export type RuleBreak = { rule: string; message: string };

export type RaceWeek = { weekStart: string; date: string; sport: PlanSport; effort: RaceEffort };
export type RaceEffort = "perform" | GoalEffort;

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
  fromWeek: string;
  today: string;
  frozen: PlannedSession[];
  runs: SportDay[];
  rides: SportDay[];
  swims: SportDay[];
  races: RaceWeek[];
  neighbours: PlannedSession[];
  easySecPerKm: number;
  easySecPer100m: number;
  paces: Record<PaceType, PaceRange> | null;
  racePaces: number[];
  allowShort?: true;
  longestBefore?: Partial<Record<PlanSport, Record<string, number>>>;
};

export const BUDGET_TOLERANCE = 1.05;
const BUDGET_FLOOR = 0.9;
const REACH_SHARE = 0.85;
const LONGEST_WINDOW_DAYS = 30;
const LONGEST_WINDOW_WEEKS = 4;
export const MAX_LONG_MINUTES = 150;
export const MAX_LONG_RIDE_MINUTES = 360;
export const MAX_LONG_SWIM_MINUTES = 120;
export const MAX_QUALITY_ACROSS_SPORTS = 3;

export function maxQualitySessions(perWeek: number) {
  return perWeek <= 3 ? 1 : perWeek <= 5 ? 2 : 3;
}

export function maxLongShare(runsInWeek: number) {
  if (runsInWeek <= 1) return 1;
  return Math.max(0.3, 2 / (runsInWeek + 1));
}

export function maxLongRideShare(ridesInWeek: number) {
  if (ridesInWeek <= 1) return 1;
  return ridesInWeek === 2 ? 0.6 : ridesInWeek === 3 ? 0.5 : 0.4;
}

const SPORT_RULES = {
  run: {
    noun: "run",
    plural: "runs",
    amount: (session: Pick<PlannedSession, "distanceKm" | "minutes">) => session.distanceKm,
    dayAmount: (day: SportDay) => day.km,
    text: (km: number) => `${Math.round(km * 10) / 10} km`,
    growth: 1.1,
    minLongest: 5,
    maxLongMinutes: MAX_LONG_MINUTES,
    minSession: 3,
    longShare: maxLongShare,
  },
  ride: {
    noun: "ride",
    plural: "rides",
    amount: (session: Pick<PlannedSession, "distanceKm" | "minutes">) => session.minutes,
    dayAmount: (day: SportDay) => day.minutes,
    text: (minutes: number) => minutesText(Math.round(minutes)),
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
    growth: 1.15,
    minLongest: 2000,
    maxLongMinutes: MAX_LONG_SWIM_MINUTES,
    minSession: 1000,
    longShare: maxLongRideShare,
  },
} as const satisfies Record<PlanSport, unknown>;

const historyOf = (ctx: Pick<RuleContext, "runs" | "rides" | "swims">, sport: PlanSport) =>
  sport === "run" ? ctx.runs : sport === "ride" ? ctx.rides : ctx.swims;
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
const named = (session: PlannedSession) => `Week of ${session.weekStart}, "${session.title}"`;
const racesOf = (week: WeekBudget, ctx: RuleContext, sport?: PlanSport) =>
  ctx.races.filter(
    (race) => race.weekStart === week.weekStart && (sport == null || race.sport === sport),
  );
const racesIn = (week: WeekBudget, ctx: RuleContext, sport?: PlanSport) =>
  racesOf(week, ctx, sport).length;
const qualityRacesIn = (week: WeekBudget, ctx: RuleContext, sport?: PlanSport) =>
  racesOf(week, ctx, sport).filter((race) => race.effort !== "fun").length;
const qualityEventsIn = (week: WeekBudget, ctx: RuleContext) =>
  new Set(
    racesOf(week, ctx)
      .filter((race) => race.effort !== "fun")
      .map((race) => race.date),
  ).size;
const sumOf = (sessions: PlannedSession[], sport: PlanSport) =>
  sessions.reduce((sum, session) => sum + SPORT_RULES[sport].amount(session), 0);

const daysLeft = (week: WeekBudget, today: string) =>
  Math.min(7, Math.max(0, 7 - daysBetween(week.weekStart, today)));

const PACE_SLACK_SEC = 2;

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

function drillIssue(sport: PlanSport, step: Step) {
  if (step.drill == null) return null;
  const drills = DRILLS.filter((drill) => drill.sport === sport).map((drill) => drill.id);
  if (drillOf(step.drill)?.sport !== sport) {
    return drills.length
      ? `drill ${step.drill} is not a ${SPORT_RULES[sport].noun} drill; use one of ${drills.join(", ")}, or null`
      : `a ${SPORT_RULES[sport].noun} step has drill null; drills are for swims`;
  }
  if (step.distanceM == null) return "rest at the wall has drill null";
  if (step.effort !== "easy" && step.zone !== "recovery" && step.zone !== "endurance") {
    return `a ${step.drill} drill step is swum at effort easy, or zone recovery or endurance`;
  }
  return null;
}

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

export function sessionsAvailable(week: WeekBudget, ctx: RuleContext, sport: PlanSport) {
  const kept = ctx.frozen.filter(inWeek(week, sport)).length;
  const open = Math.max(0, daysLeft(week, ctx.today) - racesIn(week, ctx, sport));
  const fun = racesIn(week, ctx, sport) - qualityRacesIn(week, ctx, sport);
  return Math.max(0, Math.min(sessionsPerWeek(ctx.availability, sport) - fun, kept + open));
}

export function leftToWrite(week: WeekBudget, ctx: RuleContext, sport: PlanSport) {
  const kept = ctx.frozen.filter(inWeek(week, sport));
  const budget = Math.max(0, Math.round((budgetOf(week, sport) - sumOf(kept, sport)) * 10) / 10);
  const sessions = budget > 0 ? sessionsAvailable(week, ctx, sport) - kept.length : 0;
  return { sessions: Math.max(0, sessions), budget };
}

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

export function longShareCount(week: WeekBudget, ctx: RuleContext, sport: PlanSport) {
  return Math.max(
    1,
    Math.min(
      sessionsAvailable(week, ctx, sport),
      Math.floor(budgetOf(week, sport) / SPORT_RULES[sport].minSession),
    ),
  );
}

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

export function weekFloor(week: WeekBudget, ctx: RuleContext, sport: PlanSport): number | null {
  if (ctx.allowShort || week.weekStart < ctx.fromWeek || week.weekStart < ctx.today) return null;
  if (week.taper || racesIn(week, ctx)) return null;
  const { limit } = longestAllowed(week.weekStart, sport, ctx, []);
  const timeCap = timeCapOf(sport, ctx);
  const reach = longShareCount(week, ctx, sport) * Math.min(timeCap, limit) * REACH_SHARE;
  return Math.round(Math.min(budgetOf(week, sport), reach) * BUDGET_FLOOR * 10) / 10;
}

export function budgetBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  for (const sport of plannedSports(ctx.availability)) {
    const { text, plural } = SPORT_RULES[sport];
    for (const week of ctx.weeks) {
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

export function weekShapeBreaks(sessions: PlannedSession[], ctx: RuleContext): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const sports = plannedSports(ctx.availability);
  for (const week of ctx.weeks) {
    const all = [...ctx.frozen, ...sessions].filter(inWeek(week));
    const allQuality =
      all.filter((session) => isQualityKind(session.kind)).length + qualityEventsIn(week, ctx);
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
      } else if (written.length && quality > maxQuality) {
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
      const longest = [...mine].sort((a, b) => rules.amount(b) - rules.amount(a))[0];
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
