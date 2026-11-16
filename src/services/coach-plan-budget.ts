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

export type SportDay = { date: string; km: number; minutes: number };
export type RunDay = SportDay;

type SportBudget = {
  amount: (day: SportDay) => number;
  cap: (biggest: number) => number;
  noHistoryPerSession: number;
};

export const MAX_WEEK_GROWTH = 1.15;

const SPORT_BUDGETS: Record<PlanSport, SportBudget> = {
  run: {
    amount: (day) => day.km,
    cap: (biggest) => biggest * MAX_WEEK_GROWTH,
    noHistoryPerSession: 3,
  },
  ride: {
    amount: (day) => day.minutes,
    cap: (biggest) => Math.max(biggest * 1.1, biggest + 30),
    noHistoryPerSession: 60,
  },
  swim: {
    amount: (day) => day.km * 1000,
    cap: (biggest) => Math.max(biggest * 1.1, biggest + 500),
    noHistoryPerSession: 1500,
  },
};

const RETURN_FLOOR_SHARE = 0.6;
const USUAL_BEST_WEEKS = 4;
const USUAL_WINDOW_WEEKS = 26;

const PHASE_GROWTH: Partial<Record<PhaseKind, number>> = { base: 1, build: 1.4, peak: 0.6 };

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

export const weeklyKm = (runs: SportDay[], weekStart: string, weeks: number) =>
  weeklyAmount(runs, weekStart, weeks, "run");

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function floorOf(days: SportDay[], weekStart: string, perWeek: number, sport: PlanSport) {
  const usual = usualWeek(days, weekStart, sport);
  return usual > 0
    ? usual * RETURN_FLOOR_SHARE
    : perWeek * SPORT_BUDGETS[sport].noHistoryPerSession;
}

function usualWeek(days: SportDay[], weekStart: string, sport: PlanSport) {
  const history = weeklyAmount(days, weekStart, USUAL_WINDOW_WEEKS, sport);
  return average([...history].sort((a, b) => b - a).slice(0, USUAL_BEST_WEEKS));
}

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

const SWIM_TAPER = [0.5, 0.7];

export type WeekShape = {
  weekStart: string;
  phase: PhaseKind;
  lighter: boolean;
  taper: boolean;
  share: number;
  anchorSports: PlanSport[];
  ramp?: number;
  daysOn?: number;
};

type AGoal = Pick<Goal, "date" | "distanceM" | "sportType" | "elevationGainM">;

export function seasonShape(
  goals: Goal[],
  aGoal: AGoal | null,
  firstWeek: string,
  count: number,
): WeekShape[] {
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addDayKey(firstWeek, 7 * index);
    const phase = seasonPhase(goals, weekStart);
    const anchorSports = [
      ...new Set(phase.anchor.flatMap((goal) => planSportOf(goal.sportType) ?? [])),
    ];
    const weeksLeft = aGoal ? Math.floor(daysBetween(weekStart, aGoal.date) / 7) : -1;
    const taper = aGoal && weeksLeft >= 0 ? taperShare(weeksLeft, aGoal) : null;
    return {
      weekStart,
      phase: phase.kind,
      lighter: phase.lighter && taper == null,
      taper: taper != null || phase.kind === "taper" || phase.kind === "race",
      share: taper ?? phase.loadFactor ?? 1,
      anchorSports: anchorSports.length ? anchorSports : PLAN_SPORTS.map((sport) => sport.id),
    };
  });
}

export type SportSeed = {
  floor: number;
  level: number;
  window: number[];
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

export const STANDARD_GROWTH = 5;

const CEILING = {
  run: { growth: 1.5, noGoalMax: 120 },
  ride: { growth: 1.35, noGoalMax: 15 * 60 },
  swim: { growth: 1.3, noGoalMax: 20_000 },
} as const satisfies Record<PlanSport, unknown>;

const RUN_RACE_PEAKS = [
  { fromKm: 45, floor: 65, max: 130 },
  { fromKm: 35, floor: 55, max: 120 },
  { fromKm: 15, floor: 40, max: 90 },
  { fromKm: 8, floor: 30, max: 70 },
  { fromKm: 0, floor: 25, max: 60 },
];

const SWIM_RACE_PEAKS = [
  { fromM: 5000, floor: 10_000, max: 20_000 },
  { fromM: 3000, floor: 7000, max: 15_000 },
  { fromM: 1700, floor: 5000, max: 12_000 },
  { fromM: 0, floor: 4000, max: 12_000 },
];

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

export function ceilingGoal(goals: Goal[], sport: PlanSport, today: string): Goal | null {
  const ahead = goals
    .filter((goal) => goal.date >= today && goal.distanceM && planSportOf(goal.sportType) === sport)
    .sort((a, b) => a.date.localeCompare(b.date));
  return ahead.find((goal) => goal.priority === "A") ?? ahead[0] ?? null;
}

export const PEAK_STEP: Record<PlanSport, number> = { run: 5, ride: 30, swim: 500 };
export const PEAK_LIMIT: Record<PlanSport, number> = { run: 200, ride: 25 * 60, swim: 60_000 };

const ROUND_TO: Record<PlanSport, number> = { run: 1, ride: 5, swim: 100 };

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
    const step = ROUND_TO[sport];
    const share = Math.min(week.ramp ?? 1, week.share);
    const amount = Math.round((share < week.share ? level * share : sized) / step) * step;
    return backOff(amount, sport, week.daysOn ?? 7);
  });
}

export type TimeOutDays = { start: string; end: string | null };

export function daysOutside(weekStart: string, timeOuts: TimeOutDays[]) {
  let days = 0;
  for (let index = 0; index < 7; index += 1) {
    const day = addDayKey(weekStart, index);
    const covered = timeOuts.some(
      (timeOut) => day >= timeOut.start && (timeOut.end == null || day <= timeOut.end),
    );
    if (!covered) days += 1;
  }
  return days;
}

const RAMP_START = [
  { fromDays: 14, share: 0.4 },
  { fromDays: 7, share: 0.6 },
  { fromDays: 1, share: 0.8 },
];
export const firstWeekBack = (daysOff: number) =>
  RAMP_START.find((item) => daysOff >= item.fromDays)?.share ?? 1;

const RAMP_STEP = 0.15;

function rampShare(weekStart: string, timeOuts: TimeOutDays[]) {
  let ramp = 1;
  for (const { start, end } of timeOuts) {
    if (end == null || end >= weekStart) continue;
    const daysOff = daysBetween(start, end) + 1;
    const first = firstWeekBack(daysOff);
    const weeksBack = Math.floor((daysBetween(end, weekStart) - 1) / 7);
    ramp = Math.min(ramp, Math.round((first + RAMP_STEP * weeksBack) * 100) / 100);
  }
  return ramp;
}

export function withTimeOuts(shape: WeekShape[], timeOuts: TimeOutDays[]): WeekShape[] {
  return shape.map((week) => ({
    ...week,
    ramp: rampShare(week.weekStart, timeOuts),
    daysOn: daysOutside(week.weekStart, timeOuts),
  }));
}

function backOff(amount: number, sport: PlanSport, days: number) {
  if (days >= 7) return amount;
  const step = ROUND_TO[sport];
  return Math.floor((amount * days) / (7 * step) + 1e-9) * step;
}

export type WeekBudget = {
  weekStart: string;
  budgetKm: number;
  budgetMinutes: number;
  budgetSwimM: number;
  phase: PhaseKind;
  lighter: boolean;
  taper: boolean;
};

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

export function weekBudgets(input: {
  runs: SportDay[];
  rides: SportDay[];
  swims: SportDay[];
  goals: Goal[];
  aGoal: AGoal | null;
  firstWeek: string;
  count: number;
  availability: Availability;
  progression: Progression;
  timeOuts?: TimeOutDays[];
}): WeekBudget[] {
  const { goals, aGoal, firstWeek, count, availability, progression, timeOuts = [] } = input;
  const shape = withTimeOuts(seasonShape(goals, aGoal, firstWeek, count), timeOuts);
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

export function plannedAmount(week: Pick<PlanWeek, "sessions">, sport: PlanSport) {
  return week.sessions
    .filter((session) => session.sport === sport && session.kind !== "race")
    .reduce((sum, session) => sum + sessionAmount(session), 0);
}

const BAND = { over: 1.05, under: 0.9 };

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
