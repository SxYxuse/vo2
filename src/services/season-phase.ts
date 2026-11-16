import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import { ATL_DAYS, CTL_DAYS } from "./training-load.ts";
import { addDayKey } from "./day-key.ts";
import {
  anchorEvent,
  daysBetween,
  eventEffort,
  eventPriority,
  seasonEvents,
  type Goal,
  type SeasonEvent,
} from "./season.types.ts";

export const PHASES = {
  hold: { label: "Hold", hint: "No main goal ahead: keep fitness where it is." },
  base: { label: "Base", hint: "Unhurried volume, mostly easy, a long session that grows." },
  build: { label: "Build", hint: "Fitness rises toward the goal with race-specific sessions." },
  maintain: {
    label: "Maintain",
    hint: "The last goal was close: hold fitness, then peak again.",
  },
  peak: { label: "Peak", hint: "The longest and most race-like weeks." },
  taper: { label: "Taper", hint: "Less volume so form turns fresh for race day." },
  race: { label: "Race week", hint: "Short and sharp; arrive fresh." },
  recovery: { label: "Recovery", hint: "Easy days after the race. No hard sessions." },
} as const;

export const LIGHTER_HINT = "A lighter week so the last three weeks of work sink in.";

export type PhaseKind = keyof typeof PHASES;

export const BASE_WEEKS = 12;
export const PEAK_WEEKS = 3;
export const REBUILD_WEEKS = 8;
export const LIGHTER_EVERY_WEEKS = 4;
export const LIGHTER_LOAD_FACTOR = 0.7;
export const STEADY_RACE_LOAD_FACTOR = 0.85;
export const NO_RAMP_AFTER_A_DAYS = 13;
export const MAX_RAMP_RATIO = 1.1;

export type SeasonPhase = {
  kind: PhaseKind;
  anchor: Goal[];
  daysToAnchor: number | null;
  lighter: boolean;
  ramp: number;
  loadFactor: number | null;
};

export type GroupPace = { kmh: number; climbPerKm: number };

const RAMP = { base: 5, build: 7, peak: 5 } as const;

const HOLD: SeasonPhase = {
  kind: "hold",
  anchor: [],
  daysToAnchor: null,
  lighter: false,
  ramp: 0,
  loadFactor: null,
};

export function seasonPhase(goals: Goal[], weekStart: string): SeasonPhase {
  const events = seasonEvents(goals);
  const phase = mainPhase(events, weekStart);
  if (phase.kind === "taper" || phase.kind === "race" || phase.kind === "recovery") return phase;
  return events
    .map((event) => supportingWeek(event, weekStart))
    .reduce<SeasonPhase>(
      (week, change) =>
        change && change.loadFactor! < (week.loadFactor ?? 1) ? { ...week, ...change } : week,
      phase,
    );
}

function mainPhase(events: SeasonEvent[], weekStart: string): SeasonPhase {
  const ahead = events.filter((event) => daysBetween(weekStart, event.date) >= 0);
  const lastA = events
    .filter((event) => daysBetween(weekStart, event.date) < 0 && eventPriority(event) === "A")
    .at(-1);
  const sinceLast = lastA ? -daysBetween(weekStart, lastA.date) : null;
  const justRaced = sinceLast != null && sinceLast <= 7;

  const anchorAhead = anchorEvent(ahead);
  if (!anchorAhead) {
    if (justRaced) return recoveryPhase(lastA!.goals);
    if (sinceLast != null && sinceLast <= NO_RAMP_AFTER_A_DAYS)
      return { ...HOLD, kind: "maintain" };
    return baseFitness(weekStart);
  }
  const anchor = anchorAhead.goals;
  const daysToAnchor = daysBetween(weekStart, anchorAhead.date);
  const weeksLeft = Math.floor(daysToAnchor / 7);

  let phase: SeasonPhase;
  if (justRaced) {
    phase = recoveryPhase(lastA!.goals);
  } else if (weeksLeft === 0) {
    phase = { ...HOLD, kind: "race", loadFactor: 0.5 };
  } else if (weeksLeft === 1) {
    phase = { ...HOLD, kind: "taper", loadFactor: 0.75 };
  } else if (weeksLeft <= PEAK_WEEKS) {
    phase = { ...HOLD, kind: "peak", ramp: RAMP.peak };
  } else if (weeksLeft <= BASE_WEEKS) {
    const rebuilding = sinceLast != null && sinceLast + daysToAnchor < REBUILD_WEEKS * 7;
    phase = rebuilding
      ? { ...HOLD, kind: "maintain" }
      : { ...HOLD, kind: "build", ramp: RAMP.build };
  } else {
    phase = { ...HOLD, kind: "base", ramp: RAMP.base };
  }

  if (
    sinceLast != null &&
    sinceLast <= NO_RAMP_AFTER_A_DAYS &&
    (phase.kind === "base" || phase.kind === "build" || phase.kind === "peak")
  ) {
    phase = { ...phase, kind: "maintain", ramp: 0 };
  }

  const lighter =
    (phase.kind === "base" || phase.kind === "build") &&
    weeksLeft > PEAK_WEEKS &&
    weeksLeft % LIGHTER_EVERY_WEEKS === 0;
  if (lighter) {
    phase = {
      ...phase,
      lighter: true,
      ramp: 0,
      loadFactor: LIGHTER_LOAD_FACTOR,
    };
  }

  return { ...phase, anchor, daysToAnchor };
}

const BASE_FITNESS_EPOCH = "2024-01-01";

function baseFitness(weekStart: string): SeasonPhase {
  const lighter =
    Math.floor(daysBetween(BASE_FITNESS_EPOCH, weekStart) / 7) % LIGHTER_EVERY_WEEKS ===
    LIGHTER_EVERY_WEEKS - 1;
  return lighter
    ? { ...HOLD, kind: "base", lighter, loadFactor: LIGHTER_LOAD_FACTOR }
    : { ...HOLD, kind: "base", ramp: RAMP.base };
}

function supportingWeek(event: SeasonEvent, weekStart: string): Partial<SeasonPhase> | null {
  const effort = eventEffort(event);
  if (effort == null || effort === "fun") return null;
  const days = daysBetween(weekStart, event.date);
  const weeksLeft = Math.floor(days / 7);
  const after = days < 0 && days >= -7;
  if (effort === "steady") {
    if (weeksLeft === 0) return { ramp: 0, loadFactor: STEADY_RACE_LOAD_FACTOR };
    if (after) return { lighter: true, ramp: 0, loadFactor: LIGHTER_LOAD_FACTOR };
    return null;
  }
  if (weeksLeft === 1) return { kind: "taper", lighter: false, ramp: 0, loadFactor: 0.75 };
  if (weeksLeft === 0) return { kind: "race", lighter: false, ramp: 0, loadFactor: 0.5 };
  if (after) return { kind: "recovery", lighter: false, ramp: 0, loadFactor: 0.6 };
  return null;
}

function recoveryPhase(raced: Goal[]): SeasonPhase {
  return {
    ...HOLD,
    kind: "recovery",
    anchor: raced,
    loadFactor: 0.6,
  };
}

export function supportingRaceBlock(
  goals: Pick<Goal, "id" | "name" | "date" | "priority">[],
  race: Pick<Goal, "date" | "priority">,
  except: string[] = [],
): string | null {
  if (race.priority !== "B") return null;
  const taperStart = (date: string) => addDayKey(mondayOf(date), -7);
  const main = goals
    .filter((goal) => goal.priority === "A" && !except.includes(goal.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .find((goal) => race.date <= goal.date && race.date >= taperStart(goal.date));
  return main
    ? `This falls in the taper for ${main.name}: the week before it and its race week stay clear. Pick another date, or make it a main goal.`
    : null;
}

const PACE_DAYS = 120;

export function recentPaces(
  rows: {
    sportType: string;
    startDate: Date;
    movingTime: number;
    distance: number | null;
    totalElevationGain: number | null;
  }[],
  now: Date,
): Partial<Record<SportGroupId, GroupPace>> {
  const since = now.getTime() - PACE_DAYS * 86_400_000;
  const totals = new Map<SportGroupId, { km: number; hours: number; climb: number }>();
  for (const row of rows) {
    const group = sportGroupFor(row.sportType)?.id;
    if (!group || !row.distance || row.movingTime <= 0 || row.startDate.getTime() < since) continue;
    if (row.sportType.startsWith("Virtual")) continue;
    const total = totals.get(group) ?? { km: 0, hours: 0, climb: 0 };
    total.km += row.distance / 1000;
    total.hours += row.movingTime / 3600;
    total.climb += row.totalElevationGain ?? 0;
    totals.set(group, total);
  }
  const paces: Partial<Record<SportGroupId, GroupPace>> = {};
  for (const [group, total] of totals) {
    if (total.hours < 1 || total.km <= 0) continue;
    paces[group] = { kmh: total.km / total.hours, climbPerKm: total.climb / total.km };
  }
  return paces;
}

const CLIMB_MINUTES_PER_100M: Record<SportGroupId, number> = {
  cycling: 6,
  running: 10,
  walking: 15,
  swimming: 0,
};
export function expectedGoalMinutes(
  goal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">,
  pace: GroupPace | undefined,
) {
  const group = sportGroupFor(goal.sportType)?.id;
  if (!group || goal.distanceM == null || !pace || pace.kmh <= 0) return null;
  const km = goal.distanceM / 1000;
  const extraClimb = Math.max(0, (goal.elevationGainM ?? 0) - pace.climbPerKm * km);
  return Math.round((km / pace.kmh) * 60 + (extraClimb / 100) * CLIMB_MINUTES_PER_100M[group]);
}

export function rampFor(ramp: number, form: number) {
  if (form < -30) return Math.min(ramp, 0);
  if (form < -18) return Math.min(ramp, 5);
  if (form < -10) return Math.min(ramp, 8);
  return ramp;
}

export type WeekLoad = {
  load: number;
  limitedBy: "ramp-cap" | "form" | null;
};

export function phaseWeekLoad(
  phase: Pick<SeasonPhase, "ramp" | "loadFactor">,
  fitness: { ctl: number; atl: number },
  recentAverageLoad: number | null = null,
): WeekLoad {
  const { ctl, atl } = fitness;
  const hold = 7 * ctl;
  if (phase.loadFactor != null) return { load: hold * phase.loadFactor, limitedBy: null };
  const ramp = rampFor(phase.ramp, ctl - atl);
  const wanted = Math.max(0, hold + CTL_DAYS * ramp);
  const formLimited = ramp < phase.ramp;
  if (recentAverageLoad != null && recentAverageLoad > 0) {
    const cap = Math.max(hold, recentAverageLoad * MAX_RAMP_RATIO);
    if (wanted > cap) return { load: cap, limitedBy: "ramp-cap" };
  }
  return { load: wanted, limitedBy: formLimited ? "form" : null };
}

export function rampBaseLoad(weekLoads: number[]): number | null {
  const recent = weekLoads.slice(-4);
  if (!recent.length || recent.every((load) => load <= 0)) return null;
  const kept = recent.length > 3 ? [...recent].sort((a, b) => b - a).slice(0, 3) : recent;
  return kept.reduce((sum, load) => sum + load, 0) / kept.length;
}

export function weekLoadsBefore(
  days: { date: string; load: number }[],
  weekStart: string,
  weeks = 4,
): number[] {
  const loads = Array.from({ length: weeks }, () => 0);
  const from = addDayKey(weekStart, -7 * weeks);
  for (const day of days) {
    if (day.date < from || day.date >= weekStart) continue;
    const index = Math.floor(daysBetween(from, day.date) / 7);
    loads[index]! += day.load;
  }
  return loads.some((load) => load > 0) ? loads : [];
}

export function mondayOf(key: string) {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDayKey(key, -((weekday + 6) % 7));
}

export type SeasonWeek = { weekStart: string; phase: PhaseKind; lighter: boolean };

export function seasonWeeks(goals: Goal[], fromDay: string, toDay: string): SeasonWeek[] {
  const weeks: SeasonWeek[] = [];
  for (let week = mondayOf(fromDay); week <= toDay; week = addDayKey(week, 7)) {
    const phase = seasonPhase(goals, week);
    weeks.push({ weekStart: week, phase: phase.kind, lighter: phase.lighter });
  }
  return weeks;
}

export function projectRaceDay(
  fitness: { ctl: number; atl: number },
  goals: Goal[],
  today: string,
  goalDate: string,
  recentWeekLoads: number[] = [],
) {
  let { ctl, atl } = fitness;
  let dailyLoad = 0;
  const loads = [...recentWeekLoads];
  for (let day = addDayKey(today, 1); day < goalDate; day = addDayKey(day, 1)) {
    const weekStart = mondayOf(day);
    if (day === weekStart || day === addDayKey(today, 1)) {
      const { load } = phaseWeekLoad(
        seasonPhase(goals, weekStart),
        { ctl, atl },
        rampBaseLoad(loads),
      );
      dailyLoad = load / 7;
      if (day === weekStart) loads.push(load);
    }
    ctl += (dailyLoad - ctl) / CTL_DAYS;
    atl += (dailyLoad - atl) / ATL_DAYS;
  }
  return { ctl, atl, form: ctl - atl };
}
