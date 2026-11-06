import {
  budgetOf,
  PLAN_SPORTS,
  planSportOf,
  sessionAmount,
  sessionsPerWeek,
  type Availability,
  type PlanSport,
  type PlanWeek,
  type Progression,
} from "./coach-plan.types.ts";
import { seasonPhase, type PhaseKind } from "./season-phase.ts";
import { daysBetween, roughGoalHours, type Goal } from "./season.types.ts";
import { addDayKey } from "./day-key.ts";

/*
 * The coach plan's weekly budgets (ADR 0037, ADR 0050, ADR 0061). VO2 sets how far the athlete runs
 * and swims and how long they ride each week; the coach only writes sessions inside them. Runs are
 * budgeted in km, swims in metres, rides in minutes, since a ride's distance hangs on terrain,
 * wind, and drafting while a pool's lengths are exact. Each sport grows
 * at the athlete's progression up to a peak ceiling (ADR 0058). Pure, and shared with the app, so
 * Plan and Settings draw the season from the same numbers the coach is held to.
 */

/** An activity as the budget and the rules read it: its day, distance, and time. */
export type SportDay = { date: string; km: number; minutes: number };
/** A run as the budget and the rules read it. */
export type RunDay = SportDay;

/** How each sport's week is measured and allowed to grow. */
type SportBudget = {
  /** The week's amount of an activity: km for runs, minutes for rides, metres for swims. */
  amount: (day: SportDay) => number;
  /** Never more than this over the biggest of the last four weeks (rule 1). */
  cap: (biggest: number) => number;
  /** With no history in six months, the floor per planned session. */
  noHistoryPerSession: number;
};

/** Runs: never 15 % above the biggest recent week (ADR 0037). */
export const MAX_WEEK_GROWTH = 1.15;

const SPORT_BUDGETS: Record<PlanSport, SportBudget> = {
  run: {
    amount: (day) => day.km,
    cap: (biggest) => biggest * MAX_WEEK_GROWTH,
    noHistoryPerSession: 3,
  },
  // Rides: 10 % a week, the volume growth cycling coaches allow, but at least half an hour so a
  // rider starting from little can grow (`coaching/cycling.md`).
  ride: {
    amount: (day) => day.minutes,
    cap: (biggest) => Math.max(biggest * 1.1, biggest + 30),
    noHistoryPerSession: 60,
  },
  // Swims: 10 % a week, as swim coaches advise for the shoulder, or 500 m for a small week
  // (`coaching/swimming.md`).
  swim: {
    amount: (day) => day.km * 1000,
    cap: (biggest) => Math.max(biggest * 1.1, biggest + 500),
    noHistoryPerSession: 1500,
  },
};

/** After a break, the floor is this share of the usual week before it. */
const RETURN_FLOOR_SHARE = 0.6;
/** The usual week: the average of the best this many weeks... */
const USUAL_BEST_WEEKS = 4;
/** ...in the last this many weeks (six months). */
const USUAL_WINDOW_WEEKS = 26;

/**
 * How fast each phase grows, as a share of the athlete's progression (the base phase's weekly
 * growth): Standard's 5 % grows base weeks 5 %, build 7 %, and peak 3 % (ADR 0058).
 */
const PHASE_GROWTH: Partial<Record<PhaseKind, number>> = { base: 1, build: 1.4, peak: 0.6 };

/** One sport's amount per week for the `weeks` whole weeks before `weekStart`, oldest first. */
export function weeklyAmount(
  days: SportDay[],
  weekStart: string,
  weeks: number,
  sport: PlanSport,
): number[] {
  const totals = Array.from({ length: weeks }, () => 0);
  const from = addDayKey(weekStart, -7 * weeks);
  for (const day of days) {
    if (day.date < from || day.date >= weekStart) continue;
    totals[Math.floor(daysBetween(from, day.date) / 7)]! += SPORT_BUDGETS[sport].amount(day);
  }
  return totals;
}

/** Km per week for the `weeks` whole weeks before `weekStart`, oldest first. */
export const weeklyKm = (runs: SportDay[], weekStart: string, weeks: number) =>
  weeklyAmount(runs, weekStart, weeks, "run");

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * The lowest week VO2 plans. With none of the sport in six months: sessions per week × 3 km of
 * running, 60 minutes of riding, or 1,500 m of swimming. Otherwise 60 % of the usual week (the best four of the last six
 * months), so an athlete back from a break restarts near where they were, not from the little
 * since.
 */
export function floorOf(days: SportDay[], weekStart: string, perWeek: number, sport: PlanSport) {
  const usual = usualWeek(days, weekStart, sport);
  return usual > 0
    ? usual * RETURN_FLOOR_SHARE
    : perWeek * SPORT_BUDGETS[sport].noHistoryPerSession;
}

/** The usual week: the average of the best four of the last six months, 0 without history. */
function usualWeek(days: SportDay[], weekStart: string, sport: PlanSport) {
  const history = weeklyAmount(days, weekStart, USUAL_WINDOW_WEEKS, sport);
  return average([...history].sort((a, b) => b - a).slice(0, USUAL_BEST_WEEKS));
}

/**
 * The share of the usual week a taper keeps, by weeks left to the A goal (0 is race week): two
 * weeks before a marathon or a ride of five hours or more, two gentler ones before a half, one
 * before shorter races (Bosquet 2007: volume cut 41–60 % over two weeks; `coaching/cycling.md`
 * for rides). The race itself is not in the budget. The A goal's taper holds for both sports.
 */
function taperShare(
  weeksLeft: number,
  aGoal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">,
) {
  const sport = planSportOf(aGoal.sportType);
  if (sport === "ride") {
    return roughGoalHours(aGoal) >= 5
      ? ([0.5, 0.6, 0.85][weeksLeft] ?? null)
      : ([0.5, 0.75][weeksLeft] ?? null);
  }
  if (sport === "swim") return SWIM_TAPER[weeksLeft] ?? null;
  const raceKm = (aGoal.distanceM ?? 0) / 1000;
  if (raceKm >= 35) return [0.4, 0.6, 0.8][weeksLeft] ?? null;
  if (raceKm >= 15) return [0.5, 0.7, 0.9][weeksLeft] ?? null;
  return [0.5, 0.75][weeksLeft] ?? null;
}

/**
 * The share a swim goal's taper keeps, race week first (`coaching/swimming.md`): two weeks, 70 %
 * then 50 %, a cut inside the 41–60 % that worked best (Bosquet 2007), intensity kept.
 */
const SWIM_TAPER = [0.5, 0.7];

// ----- The season's budgets (ADR 0058) -----

/** A week of the season as every sport reads it: its phase and the share of the level it keeps. */
export type WeekShape = {
  weekStart: string;
  phase: PhaseKind;
  lighter: boolean;
  taper: boolean;
  /** The share of the level the week keeps: a lighter week, the taper, a supporting race. */
  share: number;
  /** The sports of the A event the week builds toward: they grow by default. */
  anchorSports: PlanSport[];
};

/** The season's weeks from `firstWeek`, `count` of them, toward the A goal. */
export function seasonShape(
  goals: Goal[],
  aGoal: Pick<Goal, "date" | "distanceM" | "sportType" | "elevationGainM">,
  firstWeek: string,
  count: number,
): WeekShape[] {
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addDayKey(firstWeek, 7 * index);
    const phase = seasonPhase(goals, weekStart);
    const weeksLeft = Math.floor(daysBetween(weekStart, aGoal.date) / 7);
    const taper = weeksLeft >= 0 ? taperShare(weeksLeft, aGoal) : null;
    return {
      weekStart,
      phase: phase.kind,
      lighter: phase.lighter && taper == null,
      taper: taper != null || phase.kind === "taper" || phase.kind === "race",
      share: taper ?? phase.loadFactor ?? 1,
      anchorSports: [...new Set(phase.anchor.flatMap((goal) => planSportOf(goal.sportType) ?? []))],
    };
  });
}

/** Where a sport's season starts from, read from its history. */
export type SportSeed = {
  /** The lowest week planned: after a break, or without history (floorOf). */
  floor: number;
  /** The level the first week starts from: the best three of the last four weeks. */
  level: number;
  /** The four weeks before the first, for the cap. */
  window: number[];
  /** The usual week, or the floor without history, never under the level: the ceiling's base. */
  usual: number;
};

export function sportSeed(
  days: SportDay[],
  firstWeek: string,
  perWeek: number,
  sport: PlanSport,
): SportSeed {
  const recent = weeklyAmount(days, firstWeek, 4, sport);
  const floor = floorOf(days, firstWeek, perWeek, sport);
  const level = Math.max(floor, average([...recent].sort((a, b) => b - a).slice(0, 3)));
  const usual =
    usualWeek(days, firstWeek, sport) || perWeek * SPORT_BUDGETS[sport].noHistoryPerSession;
  return { floor, level, window: recent, usual: Math.max(usual, level) };
}

/** Standard: the growth before the athlete could set one, and the default for the A goal's sport. */
export const STANDARD_GROWTH = 5;

/**
 * The season's relative growth (`G`), and the biggest peak VO2 recommends without a goal in the
 * sport. From the published plans: runners peak about 1.2 to 2.5 times what they ran, and riders'
 * biggest week is about 1.35 times their average (Friel). No source sets swimmers'; 1.3 is
 * guidance (`coaching/swimming.md`). Never more than twice the usual week.
 */
const CEILING = {
  run: { growth: 1.5, noGoalMax: 120 },
  ride: { growth: 1.35, noGoalMax: 15 * 60 },
  swim: { growth: 1.3, noGoalMax: 20_000 },
} as const satisfies Record<PlanSport, unknown>;

/** Running race floors and peaks by race distance, longest first (`coaching/running.md`). */
const RUN_RACE_PEAKS = [
  { fromKm: 45, floor: 65, max: 130 },
  { fromKm: 35, floor: 55, max: 120 },
  { fromKm: 15, floor: 40, max: 90 },
  { fromKm: 8, floor: 30, max: 70 },
  { fromKm: 0, floor: 25, max: 60 },
];

/** Swim race floors and peaks in metres by race distance, longest first (`coaching/swimming.md`). */
const SWIM_RACE_PEAKS = [
  { fromM: 5000, floor: 10_000, max: 20_000 },
  { fromM: 3000, floor: 7000, max: 15_000 },
  { fromM: 1700, floor: 5000, max: 12_000 },
  { fromM: 0, floor: 4000, max: 12_000 },
];

/**
 * What a goal asks of the sport's peak week: a floor below which the season is thin for it, and a
 * max beyond what recreational plans prescribe. Rides read the event's rough hours; 15 h keeps a
 * 6 h long ride at 40 % of the week.
 */
export function racePeak(
  sport: PlanSport,
  goal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">,
): { floor: number; max: number } {
  if (sport === "run") {
    const km = (goal.distanceM ?? 0) / 1000;
    const { floor, max } = RUN_RACE_PEAKS.find((race) => km >= race.fromKm)!;
    return { floor, max };
  }
  if (sport === "swim") {
    const metres = goal.distanceM ?? 0;
    const { floor, max } = SWIM_RACE_PEAKS.find((race) => metres >= race.fromM)!;
    return { floor, max };
  }
  const hours = roughGoalHours(goal);
  return {
    floor: Math.max(240, hours * 90),
    max: Math.min(900, Math.max(480, hours * 180)),
  };
}

/**
 * The peak ceiling VO2 recommends: the usual week grown by the season's relative growth, at most
 * doubled, raised toward the goal's floor and held under its max. An athlete already above it
 * holds, never cut. Without a goal in the sport, the relative growth alone, under a top.
 */
export function recommendedPeak(
  sport: PlanSport,
  usual: number,
  goal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM"> | null,
) {
  const { growth, noGoalMax } = CEILING[sport];
  if (!goal) return Math.max(usual, Math.min(usual * growth, usual * 2, noGoalMax));
  const race = racePeak(sport, goal);
  return Math.max(usual, Math.min(race.max, usual * 2, Math.max(race.floor, usual * growth)));
}

/** The goal that sets a sport's ceiling: its next A goal, else its next goal, with a distance. */
export function ceilingGoal(goals: Goal[], sport: PlanSport, today: string): Goal | null {
  const ahead = goals
    .filter((goal) => goal.date >= today && goal.distanceM && planSportOf(goal.sportType) === sport)
    .sort((a, b) => a.date.localeCompare(b.date));
  return ahead.find((goal) => goal.priority === "A") ?? ahead[0] ?? null;
}

/**
 * The athlete's own peak moves in round steps (km of running, minutes of riding, metres of
 * swimming), and stops only
 * where a number can no longer be meant: past any recreational week, to catch a slip of the thumb,
 * not to second-guess the athlete (ADR 0058).
 */
export const PEAK_STEP: Record<PlanSport, number> = { run: 5, ride: 30, swim: 500 };
export const PEAK_LIMIT: Record<PlanSport, number> = { run: 200, ride: 25 * 60, swim: 60_000 };

/** Budgets are rounded to a step the athlete reads: whole km, 5 minutes, 100 m. */
const ROUND_TO: Record<PlanSport, number> = { run: 1, ride: 5, swim: 100 };

/**
 * One sport's week amounts through the season. The level grows by the progression (or, when the
 * athlete set none, Standard for the A event's sports and none for the others, as before ADR
 * 0058), never past the cap over the biggest of the four weeks before, never under the floor,
 * and never above the ceiling; each week then keeps its share.
 */
export function projectSport(
  shape: WeekShape[],
  seed: SportSeed,
  sport: PlanSport,
  growth: number | null,
  ceiling: number,
): number[] {
  let level = seed.level;
  const window = [...seed.window];
  return shape.map((week, index) => {
    const rate = growth ?? (week.anchorSports.includes(sport) ? STANDARD_GROWTH : 0);
    if (index > 0) level *= 1 + (rate / 100) * (PHASE_GROWTH[week.phase] ?? 0);
    const biggest = Math.max(...window.slice(-4));
    const cap = biggest > 0 ? SPORT_BUDGETS[sport].cap(biggest) : Number.POSITIVE_INFINITY;
    level = Math.min(ceiling, Math.max(seed.floor, Math.min(cap, level)));
    const sized = Math.round(level * week.share);
    window.push(sized);
    return Math.round(sized / ROUND_TO[sport]) * ROUND_TO[sport];
  });
}

export type WeekBudget = {
  weekStart: string;
  /** Running km (rule 1); 0 when the athlete plans no runs. */
  budgetKm: number;
  /** Riding minutes (rule 1); 0 when the athlete plans no rides. */
  budgetMinutes: number;
  /** Swimming metres (rule 1); 0 when the athlete plans no swims. */
  budgetSwimM: number;
  phase: PhaseKind;
  lighter: boolean;
  taper: boolean;
};

/** A sport's ceiling: the athlete's own peak, or the one VO2 recommends. */
export function ceilingOf(
  sport: PlanSport,
  seed: SportSeed,
  goals: Goal[],
  today: string,
  progression: Progression,
) {
  return (
    progression[sport]?.peak ?? recommendedPeak(sport, seed.usual, ceilingGoal(goals, sport, today))
  );
}

/**
 * Budgets for `count` weeks from `firstWeek`, per sport: each sport's projection (projectSport)
 * from its history, at the athlete's progression and up to its ceiling. Lighter weeks keep 70 %,
 * the taper its share, and the weeks around a supporting race what its effort keeps (ADR 0052);
 * the level grows on underneath.
 */
export function weekBudgets(input: {
  runs: SportDay[];
  rides: SportDay[];
  swims: SportDay[];
  goals: Goal[];
  aGoal: Pick<Goal, "date" | "distanceM" | "sportType" | "elevationGainM">;
  firstWeek: string;
  count: number;
  availability: Availability;
  progression: Progression;
}): WeekBudget[] {
  const { goals, aGoal, firstWeek, count, availability, progression } = input;
  const shape = seasonShape(goals, aGoal, firstWeek, count);
  const amounts = (sport: PlanSport, days: SportDay[]) => {
    const perWeek = sessionsPerWeek(availability, sport);
    if (!perWeek) return shape.map(() => 0);
    const seed = sportSeed(days, firstWeek, perWeek, sport);
    const ceiling = ceilingOf(sport, seed, goals, firstWeek, progression);
    return projectSport(shape, seed, sport, progression[sport]?.growth ?? null, ceiling);
  };
  const run = amounts("run", input.runs);
  const ride = amounts("ride", input.rides);
  const swim = amounts("swim", input.swims);
  return shape.map((week, index) => ({
    weekStart: week.weekStart,
    budgetKm: run[index]!,
    budgetMinutes: ride[index]!,
    budgetSwimM: swim[index]!,
    phase: week.phase,
    lighter: week.lighter,
    taper: week.taper,
  }));
}

/** What a written week holds of a sport, races aside (they're not in the budget). */
export function plannedAmount(week: Pick<PlanWeek, "sessions">, sport: PlanSport) {
  return week.sessions
    .filter((session) => session.sport === sport && session.kind !== "race")
    .reduce((sum, session) => sum + sessionAmount(session), 0);
}

/** A week may come in this much over its budget, and must reach this share of it (rule 1). */
const BAND = { over: 1.05, under: 0.9 };

/**
 * The first written week, from `fromWeek`, whose sessions a new budget leaves out of the band the
 * plan check accepts: over 105 %, or under 90 % of a budget that grew. A week the coach already
 * held lower stays (ADR 0058). Null when every written week still fits.
 */
export function firstWeekOffBudget(
  weeks: Pick<PlanWeek, "weekStart" | "sessions" | "budgetKm" | "budgetMinutes" | "budgetSwimM">[],
  budgets: WeekBudget[],
  fromWeek: string,
): string | null {
  for (const week of weeks) {
    if (week.weekStart < fromWeek) continue;
    const next = budgets.find((budget) => budget.weekStart === week.weekStart);
    if (!next) continue;
    for (const { id: sport } of PLAN_SPORTS) {
      const before = budgetOf(week, sport);
      const after = budgetOf(next, sport);
      const planned = plannedAmount(week, sport);
      if (planned > after * BAND.over || (after > before && planned < after * BAND.under)) {
        return week.weekStart;
      }
    }
  }
  return null;
}
