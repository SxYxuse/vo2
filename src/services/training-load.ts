import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay, subMonths, subYears } from "date-fns";

const CTL_DAYS = 42;
const ATL_DAYS = 7;

export type LoadSource = "power" | "heartRate" | "duration";

export type FitnessPeriod = "1m" | "3m" | "6m" | "1y" | "all";

export const FITNESS_PERIODS: { id: FitnessPeriod; label: string }[] = [
  { id: "1m", label: "1 month" },
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All" },
];

export type LoadInputs = {
  sportType: string;
  movingTime: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageWatts: number | null;
  weightedAverageWatts: number | null;
  deviceWatts: boolean;
};

export type FitnessLoad = {
  start: string;
  load: number;
  estimatedLoad: number;
  movingTime: number;
};

type PmcPoint = {
  date: string;
  t: number;
  load: number;
  measuredLoad: number;
  estimatedLoad: number;
  ctl: number;
  atl: number;
  tsb: number;
};

const HR_REST = 60;

const CYCLING_SPORTS = new Set([
  "Ride",
  "VirtualRide",
  "GravelRide",
  "MountainBikeRide",
  "EMountainBikeRide",
  "EBikeRide",
  "Velomobile",
  "Handcycle",
]);

function toZoned(date: Date, timeZone: string) {
  return new TZDate(date.getTime(), timeZone);
}

function zonedDayStart(date: Date, timeZone: string) {
  return startOfDay(toZoned(date, timeZone));
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] * (high - index) + sorted[high] * (index - low);
}

function hoursFromMoving(seconds: number) {
  return Math.max(0, seconds) / 3600;
}

function trainingStress(hours: number, intensity: number) {
  const factor = Math.min(1.2, Math.max(0.3, intensity));
  return hours * 100 * factor * factor;
}

export function isCyclingSport(sportType: string) {
  return CYCLING_SPORTS.has(sportType);
}

function durationIntensity(sportType: string) {
  if (sportType === "Walk" || sportType === "Hike") return 0.45;
  if (sportType === "Run" || sportType === "TrailRun" || sportType === "VirtualRun") return 0.7;
  if (CYCLING_SPORTS.has(sportType)) return 0.65;
  if (sportType === "Swim") return 0.65;
  if (sportType === "Workout" || sportType === "WeightTraining") return 0.5;
  return 0.55;
}

export function estimateFtp(activities: LoadInputs[]) {
  const samples = activities
    .filter(
      (activity) =>
        CYCLING_SPORTS.has(activity.sportType) &&
        activity.deviceWatts &&
        activity.movingTime >= 40 * 60,
    )
    .map((activity) => activity.weightedAverageWatts ?? activity.averageWatts)
    .filter((value): value is number => value != null && value > 50);
  const estimate = percentile(samples, 0.9);
  return estimate && estimate > 80 ? estimate : null;
}

export function estimateLthr(activities: LoadInputs[]) {
  const peak = Math.max(0, ...activities.map((activity) => activity.maxHeartrate ?? 0));
  if (peak >= 140) return Math.round(peak * 0.85);
  const averages = activities
    .map((activity) => activity.averageHeartrate)
    .filter((value): value is number => value != null && value > 80);
  const p90 = percentile(averages, 0.9);
  return p90 ? Math.round(p90 * 1.05) : null;
}

export function activityTrainingLoad(
  activity: LoadInputs,
  ftp: number | null,
  lthr: number | null,
): { load: number; source: LoadSource } {
  const hours = hoursFromMoving(activity.movingTime);
  if (hours <= 0) return { load: 0, source: "duration" };

  if (ftp && CYCLING_SPORTS.has(activity.sportType) && activity.deviceWatts) {
    const normalized = activity.weightedAverageWatts ?? activity.averageWatts;
    if (normalized && normalized > 0) {
      return { load: trainingStress(hours, normalized / ftp), source: "power" };
    }
  }

  if (lthr && activity.averageHeartrate && activity.averageHeartrate > 0) {
    const reserve = Math.max(40, lthr - HR_REST);
    return {
      load: trainingStress(hours, (activity.averageHeartrate - HR_REST) / reserve),
      source: "heartRate",
    };
  }

  return { load: trainingStress(hours, durationIntensity(activity.sportType)), source: "duration" };
}

export function toFitnessLoad(
  start: Date | string,
  load: number,
  source: LoadSource,
  movingTime = 0,
): FitnessLoad {
  return {
    start: typeof start === "string" ? start : start.toISOString(),
    load,
    estimatedLoad: source === "duration" ? load : 0,
    movingTime,
  };
}

export function buildPmc(loads: FitnessLoad[], timeZone: string): PmcPoint[] {
  if (!loads.length) return [];

  const byDay = new Map<string, { load: number; measured: number; estimated: number }>();
  for (const sample of loads) {
    const key = dayKey(new Date(sample.start), timeZone);
    const current = byDay.get(key) ?? { load: 0, measured: 0, estimated: 0 };
    current.load += sample.load;
    current.estimated += sample.estimatedLoad;
    current.measured += Math.max(0, sample.load - sample.estimatedLoad);
    byDay.set(key, current);
  }

  const starts = loads.map((sample) => zonedDayStart(new Date(sample.start), timeZone));
  const first = starts.reduce((min, day) => (day < min ? day : min));
  const last = zonedDayStart(new Date(), timeZone);

  const points: PmcPoint[] = [];
  let ctl = 0;
  let atl = 0;
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 1)) {
    const key = dayKey(cursor, timeZone);
    const day = byDay.get(key);
    const load = day?.load ?? 0;
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
    points.push({
      date: key,
      t: cursor.getTime(),
      load,
      measuredLoad: day?.measured ?? 0,
      estimatedLoad: day?.estimated ?? 0,
      ctl,
      atl,
      tsb: ctl - atl,
    });
  }
  return points;
}

export function slicePmc(points: PmcPoint[], period: FitnessPeriod, timeZone: string) {
  if (!points.length || period === "all") return points;
  const end = zonedDayStart(new Date(), timeZone);
  const start =
    period === "1y" ? subYears(end, 1) : subMonths(end, period === "1m" ? 1 : period === "3m" ? 3 : 6);
  const startMs = start.getTime();
  return points.filter((point) => point.t >= startMs);
}

export function averageWeeklyMovingSeconds(
  loads: FitnessLoad[],
  periodDays: Pick<PmcPoint, "date">[],
  timeZone: string,
) {
  if (!periodDays.length) return 0;
  const first = periodDays[0].date;
  const last = periodDays[periodDays.length - 1].date;
  let total = 0;
  for (const sample of loads) {
    const key = dayKey(new Date(sample.start), timeZone);
    if (key >= first && key <= last) total += sample.movingTime;
  }
  return total / (periodDays.length / 7);
}

export function formLabel(tsb: number) {
  if (tsb >= 15) return "Very fresh";
  if (tsb >= 5) return "Fresh";
  if (tsb >= -10) return "Neutral";
  if (tsb >= -25) return "Fatigued";
  return "Very fatigued";
}

export function roundLoad(value: number) {
  return Math.round(value * 10) / 10;
}
