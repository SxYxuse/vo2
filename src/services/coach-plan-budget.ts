import { planSportOf, type Availability, type PlanSport } from "./coach-plan.types.ts";
import { LIGHTER_LOAD_FACTOR, seasonPhase, type PhaseKind } from "./season-phase.ts";
import { daysBetween, roughGoalHours, type Goal } from "./season.types.ts";
import { addDayKey } from "./day-key.ts";

/*
 * The coach plan's weekly budgets (ADR 0037, ADR 0050). VO2 sets how far the athlete runs and how
 * long they ride each week; the coach only writes sessions inside them. Runs are budgeted in km,
 * rides in minutes, since a ride's distance hangs on terrain, wind, and drafting. Pure, so the
 * numbers are easy to follow.
 */

/** An activity as the budget and the rules read it: its day, distance, and time. */
export type SportDay = { date: string; km: number; minutes: number };
/** A run as the budget and the rules read it. */
export type RunDay = SportDay;

/** How each sport's week is measured and allowed to grow. */
type SportBudget = {
  /** The week's amount of an activity: km for runs, minutes for rides. */
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
  // rider starting from little can grow (`cycling/principles.md`).
  ride: {
    amount: (day) => day.minutes,
    cap: (biggest) => Math.max(biggest * 1.1, biggest + 30),
    noHistoryPerSession: 60,
  },
};

/** After a break, the floor is this share of the usual week before it. */
const RETURN_FLOOR_SHARE = 0.6;
/** The usual week: the average of the best this many weeks... */
const USUAL_BEST_WEEKS = 4;
/** ...in the last this many weeks (six months). */
const USUAL_WINDOW_WEEKS = 26;

/** How much a week grows on the last, by phase, before the cap. */
const GROWTH: Partial<Record<PhaseKind, number>> = { base: 1.05, build: 1.07, peak: 1.03 };

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
 * running or 60 minutes of riding. Otherwise 60 % of the usual week (the best four of the last six
 * months), so an athlete back from a break restarts near where they were, not from the little
 * since.
 */
export function floorOf(days: SportDay[], weekStart: string, perWeek: number, sport: PlanSport) {
  const history = weeklyAmount(days, weekStart, USUAL_WINDOW_WEEKS, sport);
  const usual = average([...history].sort((a, b) => b - a).slice(0, USUAL_BEST_WEEKS));
  return usual > 0
    ? usual * RETURN_FLOOR_SHARE
    : perWeek * SPORT_BUDGETS[sport].noHistoryPerSession;
}

/**
 * The share of the usual week a taper keeps, by weeks left to the A goal (0 is race week): two
 * weeks before a marathon or a ride of five hours or more, two gentler ones before a half, one
 * before shorter races (Bosquet 2007: volume cut 41–60 % over two weeks; `cycling/principles.md`
 * for rides). The race itself is not in the budget. The A goal's taper holds for both sports.
 */
function taperShare(
  weeksLeft: number,
  aGoal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">,
) {
  if (planSportOf(aGoal.sportType) === "ride") {
    return roughGoalHours(aGoal) >= 5
      ? ([0.5, 0.6, 0.85][weeksLeft] ?? null)
      : ([0.5, 0.75][weeksLeft] ?? null);
  }
  const raceKm = (aGoal.distanceM ?? 0) / 1000;
  if (raceKm >= 35) return [0.4, 0.6, 0.8][weeksLeft] ?? null;
  if (raceKm >= 15) return [0.5, 0.7, 0.9][weeksLeft] ?? null;
  return [0.5, 0.75][weeksLeft] ?? null;
}

export type WeekBudget = {
  weekStart: string;
  /** Running km (rule 1); 0 when the athlete plans no runs. */
  budgetKm: number;
  /** Riding minutes (rule 1); 0 when the athlete plans no rides. */
  budgetMinutes: number;
  phase: PhaseKind;
  lighter: boolean;
  taper: boolean;
};

/**
 * Budgets for `count` weeks from `firstWeek`, per sport. Each starts from the athlete's recent
 * level (the average of the best three of the last four weeks) and never exceeds its cap over the
 * biggest of the four weeks before it, actual or planned, unless the floor is higher. Only the
 * sports of the event the week builds toward grow with its phase; the other sport holds where it
 * is (ADR 0050). Lighter weeks keep 70 %, and the taper its share; the level grows on underneath.
 */
export function weekBudgets(input: {
  runs: SportDay[];
  rides: SportDay[];
  goals: Goal[];
  aGoal: Pick<Goal, "date" | "distanceM" | "sportType" | "elevationGainM">;
  firstWeek: string;
  count: number;
  availability: Availability;
}): WeekBudget[] {
  const { goals, aGoal, firstWeek, count, availability } = input;
  const sports = {
    run: { days: input.runs, perWeek: availability.runsPerWeek },
    ride: { days: input.rides, perWeek: availability.ridesPerWeek },
  } satisfies Record<PlanSport, unknown>;
  const state = Object.fromEntries(
    (Object.keys(sports) as PlanSport[]).map((sport) => {
      const { days, perWeek } = sports[sport];
      const recent = weeklyAmount(days, firstWeek, 4, sport);
      const floor = floorOf(days, firstWeek, perWeek, sport);
      const level = Math.max(floor, average([...recent].sort((a, b) => b - a).slice(0, 3)));
      return [sport, { floor, level, window: [...recent] }];
    }),
  ) as Record<PlanSport, { floor: number; level: number; window: number[] }>;

  const budgets: WeekBudget[] = [];
  for (let index = 0; index < count; index += 1) {
    const weekStart = addDayKey(firstWeek, 7 * index);
    const phase = seasonPhase(goals, weekStart);
    const growing = new Set(phase.anchor.map((goal) => planSportOf(goal.sportType)));
    const weeksLeft = Math.floor(daysBetween(weekStart, aGoal.date) / 7);
    const taper = weeksLeft >= 0 ? taperShare(weeksLeft, aGoal) : null;
    const share =
      taper ??
      (phase.lighter
        ? LIGHTER_LOAD_FACTOR
        : phase.kind === "recovery"
          ? (phase.loadFactor ?? 1)
          : 1);
    const sized = {} as Record<PlanSport, number>;
    for (const sport of Object.keys(sports) as PlanSport[]) {
      const sportState = state[sport];
      if (index > 0 && growing.has(sport)) sportState.level *= GROWTH[phase.kind] ?? 1;
      const biggest = Math.max(...sportState.window.slice(-4));
      const cap = biggest > 0 ? SPORT_BUDGETS[sport].cap(biggest) : Number.POSITIVE_INFINITY;
      sportState.level = Math.max(sportState.floor, Math.min(cap, sportState.level));
      sized[sport] = sports[sport].perWeek > 0 ? Math.round(sportState.level * share) : 0;
      sportState.window.push(sized[sport]);
    }
    budgets.push({
      weekStart,
      budgetKm: sized.run,
      // Whole five minutes: the coach sizes rides in round numbers.
      budgetMinutes: Math.round(sized.ride / 5) * 5,
      phase: phase.kind,
      lighter: phase.lighter && taper == null,
      taper: taper != null,
    });
  }
  return budgets;
}
