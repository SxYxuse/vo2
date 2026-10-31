import { LIGHTER_LOAD_FACTOR, seasonPhase, type PhaseKind } from "./season-phase.ts";
import { daysBetween, type Goal } from "./season.types.ts";
import { addDayKey } from "./day-key.ts";

/*
 * The coach plan's weekly running budget (ADR 0037). VO2 sets how far the athlete runs each
 * week; the coach only writes sessions inside it. Pure, so the numbers are easy to follow.
 */

/** A run as the budget and the rules read it: its day and distance. */
export type RunDay = { date: string; km: number };

/** Never more than this times the biggest of the last four weeks (rule 1). */
export const MAX_WEEK_GROWTH = 1.15;
/** After a break, the floor is this share of the usual week before it. */
const RETURN_FLOOR_SHARE = 0.6;
/** With no running history, the floor is this many km per run. */
const NO_HISTORY_KM_PER_RUN = 3;
/** The usual week: the average of the best this many weeks... */
const USUAL_BEST_WEEKS = 4;
/** ...in the last this many weeks (six months). */
const USUAL_WINDOW_WEEKS = 26;

/** How much a week grows on the last, by phase, before the 15 % cap. */
const GROWTH: Partial<Record<PhaseKind, number>> = { base: 1.05, build: 1.07, peak: 1.03 };

/** Km per week for the `weeks` whole weeks before `weekStart`, oldest first. */
export function weeklyKm(runs: RunDay[], weekStart: string, weeks: number): number[] {
  const totals = Array.from({ length: weeks }, () => 0);
  const from = addDayKey(weekStart, -7 * weeks);
  for (const run of runs) {
    if (run.date < from || run.date >= weekStart) continue;
    totals[Math.floor(daysBetween(from, run.date) / 7)]! += run.km;
  }
  return totals;
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * The lowest week VO2 plans. With no running in six months: runs per week × 3 km. Otherwise 60 %
 * of the usual week (the best four of the last six months), so an athlete back from a break
 * restarts near where they were, not from the few km since.
 */
export function floorKm(runs: RunDay[], weekStart: string, runsPerWeek: number) {
  const history = weeklyKm(runs, weekStart, USUAL_WINDOW_WEEKS);
  const usual = average([...history].sort((a, b) => b - a).slice(0, USUAL_BEST_WEEKS));
  return usual > 0 ? usual * RETURN_FLOOR_SHARE : runsPerWeek * NO_HISTORY_KM_PER_RUN;
}

/**
 * The share of the usual week a taper keeps, by weeks left to the A race (0 is race week): two
 * weeks before a marathon, two gentler ones before a half, one before shorter races (Bosquet
 * 2007: volume cut 41–60 % over two weeks). The race itself is not in the budget.
 */
function taperShare(weeksLeft: number, raceKm: number) {
  if (raceKm >= 35) return [0.4, 0.6, 0.8][weeksLeft] ?? null;
  if (raceKm >= 15) return [0.5, 0.7, 0.9][weeksLeft] ?? null;
  return [0.5, 0.75][weeksLeft] ?? null;
}

export type WeekBudget = {
  weekStart: string;
  budgetKm: number;
  phase: PhaseKind;
  lighter: boolean;
  taper: boolean;
};

/**
 * Budgets for `count` weeks from `firstWeek`. The first starts from the athlete's recent level (the
 * average of the best three of the last four weeks), each week grows by its phase, and none
 * exceeds 15 % over the biggest of the four weeks before it, actual or planned, unless the floor
 * is higher. Lighter weeks keep 70 %, and the taper its share; the level grows on underneath.
 */
export function weekBudgets(input: {
  runs: RunDay[];
  goals: Goal[];
  aGoal: Pick<Goal, "date" | "distanceM">;
  firstWeek: string;
  count: number;
  runsPerWeek: number;
}): WeekBudget[] {
  const { runs, goals, aGoal, firstWeek, count, runsPerWeek } = input;
  const recent = weeklyKm(runs, firstWeek, 4);
  const floor = floorKm(runs, firstWeek, runsPerWeek);
  let level = Math.max(floor, average([...recent].sort((a, b) => b - a).slice(0, 3)));
  const window = [...recent];
  const raceKm = (aGoal.distanceM ?? 0) / 1000;
  const budgets: WeekBudget[] = [];
  for (let index = 0; index < count; index += 1) {
    const weekStart = addDayKey(firstWeek, 7 * index);
    const phase = seasonPhase(goals, weekStart);
    if (index > 0) level *= GROWTH[phase.kind] ?? 1;
    const biggest = Math.max(...window.slice(-4));
    const cap = biggest > 0 ? biggest * MAX_WEEK_GROWTH : Number.POSITIVE_INFINITY;
    level = Math.max(floor, Math.min(cap, level));
    const weeksLeft = Math.floor(daysBetween(weekStart, aGoal.date) / 7);
    const taper = weeksLeft >= 0 ? taperShare(weeksLeft, raceKm) : null;
    const share =
      taper ??
      (phase.lighter
        ? LIGHTER_LOAD_FACTOR
        : phase.kind === "recovery"
          ? (phase.loadFactor ?? 1)
          : 1);
    const budgetKm = Math.round(level * share);
    budgets.push({
      weekStart,
      budgetKm,
      phase: phase.kind,
      lighter: phase.lighter && taper == null,
      taper: taper != null,
    });
    window.push(budgetKm);
  }
  return budgets;
}
