import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay, subDays, subMonths, subYears } from "date-fns";
import { createServerFn } from "@tanstack/react-start";

import { parseAssessmentResult } from "./assessments-score.ts";
import { estimateLthrFromMax, heartRateFamily, isPlausibleBpm } from "./heart-rate.ts";
import { normalizedPowerFromWatts } from "./normalized-power.ts";

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
export const DEFAULT_REST_HR = 60;

export type LoadSource = "power" | "heartRate" | "duration";

export type FitnessPeriod = "7d" | "1m" | "3m" | "6m" | "1y" | "all";

export const FITNESS_PERIODS: { id: FitnessPeriod; label: string; shortLabel: string }[] = [
  { id: "7d", label: "7 days", shortLabel: "7d" },
  { id: "1m", label: "1 month", shortLabel: "1m" },
  { id: "3m", label: "3 months", shortLabel: "3m" },
  { id: "6m", label: "6 months", shortLabel: "6m" },
  { id: "1y", label: "1 year", shortLabel: "1y" },
  { id: "all", label: "All", shortLabel: "All" },
];

export type LoadInputs = {
  sportType: string;
  movingTime: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageWatts: number | null;
  weightedAverageWatts: number | null;
  deviceWatts: boolean;
  wattsStream?: number[] | null;
  timeStream?: number[] | null;
};

export type LoadAnchors = {
  ftp: number | null;
  cyclingLthr: number | null;
  runLthr: number | null;
  swimLthr: number | null;
  restHr: number;
  cyclingMaxHr: number | null;
  runMaxHr: number | null;
  swimMaxHr: number | null;
  walkingMaxHr: number | null;
  otherMaxHr: number | null;
};

export type FitnessLoad = {
  start: string;
  load: number;
  estimatedLoad: number;
  movingTime: number;
};

export type PmcPoint = {
  date: string;
  t: number;
  load: number;
  measuredLoad: number;
  estimatedLoad: number;
  ctl: number;
  atl: number;
  tsb: number;
};

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

const POWER_CYCLING_SPORTS = new Set([
  "Ride",
  "VirtualRide",
  "GravelRide",
  "MountainBikeRide",
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
  if (!Number.isFinite(intensity) || intensity <= 0) return 0;
  return hours * 100 * intensity * intensity;
}

function clampRestHr(value: number) {
  return Math.min(75, Math.max(40, Math.round(value)));
}

export function isCyclingSport(sportType: string) {
  return CYCLING_SPORTS.has(sportType);
}

export function isPowerCyclingSport(sportType: string) {
  return POWER_CYCLING_SPORTS.has(sportType);
}

function durationIntensity(sportType: string) {
  if (sportType === "EBikeRide" || sportType === "EMountainBikeRide") return 0.45;
  if (sportType === "Walk" || sportType === "Hike") return 0.45;
  if (sportType === "Run" || sportType === "TrailRun" || sportType === "VirtualRun") return 0.7;
  if (CYCLING_SPORTS.has(sportType)) return 0.65;
  if (sportType === "Swim" || sportType === "OpenWaterSwim") return 0.65;
  if (sportType === "Workout" || sportType === "WeightTraining") return 0.5;
  return 0.55;
}

function sportMaxHr(sportType: string, anchors: LoadAnchors) {
  const family = heartRateFamily(sportType);
  if (family === "cycling") return anchors.cyclingMaxHr;
  if (family === "running") return anchors.runMaxHr;
  if (family === "swimming") return anchors.swimMaxHr;
  if (family === "walking") return anchors.walkingMaxHr;
  return anchors.otherMaxHr;
}

function sportLthr(sportType: string, anchors: LoadAnchors) {
  const family = heartRateFamily(sportType);
  if (family === "cycling") return anchors.cyclingLthr;
  if (family === "running") return anchors.runLthr;
  if (family === "swimming") return anchors.swimLthr;
  return null;
}

function peakByFamily(activities: LoadInputs[]) {
  const peaks: Record<"cycling" | "running" | "swimming" | "walking" | "other", number> = {
    cycling: 0,
    running: 0,
    swimming: 0,
    walking: 0,
    other: 0,
  };
  for (const activity of activities) {
    const maxHr = activity.maxHeartrate ?? 0;
    if (!isPlausibleBpm(maxHr)) continue;
    const family = heartRateFamily(activity.sportType);
    if (maxHr > peaks[family]) peaks[family] = maxHr;
  }
  const asNull = (value: number) => (value > 0 ? value : null);
  return {
    cyclingMaxHr: asNull(peaks.cycling),
    runMaxHr: asNull(peaks.running),
    swimMaxHr: asNull(peaks.swimming),
    walkingMaxHr: asNull(peaks.walking),
    otherMaxHr: asNull(peaks.other),
  };
}

function estimateRestHr(activities: LoadInputs[]) {
  const easy: number[] = [];
  for (const activity of activities) {
    const avg = activity.averageHeartrate;
    if (avg == null || avg < 40 || avg > 90) continue;
    easy.push(avg);
  }
  const p10 = percentile(easy, 0.1);
  return p10 ? clampRestHr(p10) : DEFAULT_REST_HR;
}

function estimateFtp(activities: LoadInputs[]) {
  const ftpSamples: number[] = [];
  for (const activity of activities) {
    if (
      !isPowerCyclingSport(activity.sportType) ||
      !activity.deviceWatts ||
      activity.movingTime < 40 * 60
    ) {
      continue;
    }
    const watts =
      activity.weightedAverageWatts ??
      normalizedPowerFromWatts(activity.wattsStream, activity.timeStream);
    if (watts != null && watts > 50) ftpSamples.push(watts);
  }
  const ftpEstimate = percentile(ftpSamples, 0.9);
  return ftpEstimate && ftpEstimate > 80 ? ftpEstimate : null;
}

export function estimateLoadAnchors(activities: LoadInputs[]): LoadAnchors {
  const peaks = peakByFamily(activities);
  return {
    ftp: estimateFtp(activities),
    cyclingLthr: estimateLthrFromMax(peaks.cyclingMaxHr, "cycling"),
    runLthr: estimateLthrFromMax(peaks.runMaxHr, "running"),
    swimLthr: estimateLthrFromMax(peaks.swimMaxHr, "swimming"),
    restHr: estimateRestHr(activities),
    ...peaks,
  };
}

export function pickLoadAnchorsFromTests(
  rows: Array<{ assessmentId: string; result: unknown }>,
): Partial<LoadAnchors> {
  const picked: Partial<LoadAnchors> = {};
  for (const row of rows) {
    const result = parseAssessmentResult(row.result);
    if (row.assessmentId === "ftp-20") {
      if (picked.ftp == null && result.ftpWatts != null) picked.ftp = result.ftpWatts;
      if (picked.cyclingLthr == null && result.cyclingLthr != null) {
        picked.cyclingLthr = result.cyclingLthr;
      }
      if (picked.cyclingMaxHr == null && result.peakHr != null) picked.cyclingMaxHr = result.peakHr;
    }
    if (row.assessmentId === "run-lthr" && picked.runLthr == null && result.runLthr != null) {
      picked.runLthr = result.runLthr;
    }
    if (row.assessmentId === "beep-test" && picked.runMaxHr == null && result.peakHr != null) {
      picked.runMaxHr = result.peakHr;
    }
  }
  return picked;
}

export function mergeLoadAnchors(estimated: LoadAnchors, tests: Partial<LoadAnchors>): LoadAnchors {
  return {
    ftp: tests.ftp ?? estimated.ftp,
    cyclingLthr: tests.cyclingLthr ?? estimated.cyclingLthr,
    runLthr: tests.runLthr ?? estimated.runLthr,
    swimLthr: tests.swimLthr ?? estimated.swimLthr,
    restHr: tests.restHr ?? estimated.restHr,
    cyclingMaxHr: tests.cyclingMaxHr ?? estimated.cyclingMaxHr,
    runMaxHr: tests.runMaxHr ?? estimated.runMaxHr,
    swimMaxHr: tests.swimMaxHr ?? estimated.swimMaxHr,
    walkingMaxHr: tests.walkingMaxHr ?? estimated.walkingMaxHr,
    otherMaxHr: tests.otherMaxHr ?? estimated.otherMaxHr,
  };
}

function hrIntensity(activity: LoadInputs, anchors: LoadAnchors) {
  const avg = activity.averageHeartrate;
  if (avg == null || avg <= 0) return null;
  const rest = clampRestHr(anchors.restHr);
  const lthr = sportLthr(activity.sportType, anchors);
  const ceiling = lthr ?? sportMaxHr(activity.sportType, anchors);
  if (ceiling == null || ceiling <= rest) return null;
  return (avg - rest) / (ceiling - rest);
}

export function activityTrainingLoad(
  activity: LoadInputs,
  anchors: LoadAnchors,
): { load: number; source: LoadSource } {
  const hours = hoursFromMoving(activity.movingTime);
  if (hours <= 0) return { load: 0, source: "duration" };

  if (anchors.ftp && isPowerCyclingSport(activity.sportType) && activity.deviceWatts) {
    const normalized =
      activity.weightedAverageWatts ??
      normalizedPowerFromWatts(activity.wattsStream, activity.timeStream);
    if (normalized && normalized > 0) {
      return { load: trainingStress(hours, normalized / anchors.ftp), source: "power" };
    }
  }

  const intensity = hrIntensity(activity, anchors);
  if (intensity != null) {
    return { load: trainingStress(hours, intensity), source: "heartRate" };
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

  let first = zonedDayStart(new Date(loads[0].start), timeZone);
  for (let index = 1; index < loads.length; index += 1) {
    const day = zonedDayStart(new Date(loads[index].start), timeZone);
    if (day < first) first = day;
  }
  const last = zonedDayStart(new Date(), timeZone);

  const points: PmcPoint[] = [];
  let ctl = 0;
  let atl = 0;
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 1)) {
    const key = dayKey(cursor, timeZone);
    const day = byDay.get(key);
    const load = day?.load ?? 0;
    const tsb = ctl - atl;
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
      tsb,
    });
  }
  return points;
}

export function formAfterLoad(point: Pick<PmcPoint, "ctl" | "atl">) {
  return point.ctl - point.atl;
}

export function ctlChange(points: PmcPoint[], days = 7) {
  if (points.length < 2) return 0;
  const latest = points[points.length - 1];
  const prior = points[Math.max(0, points.length - 1 - days)];
  return latest.ctl - prior.ctl;
}

export function slicePmc(points: PmcPoint[], period: FitnessPeriod, timeZone: string) {
  if (!points.length || period === "all") return points;
  const end = zonedDayStart(new Date(), timeZone);
  const start =
    period === "7d"
      ? subDays(end, 6)
      : period === "1y"
        ? subYears(end, 1)
        : subMonths(end, period === "1m" ? 1 : period === "3m" ? 3 : 6);
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
  if (tsb >= 25) return "Very fresh";
  if (tsb >= 5) return "Fresh";
  if (tsb >= -10) return "Neutral";
  if (tsb >= -30) return "Fatigued";
  return "Very fatigued";
}

export function roundLoad(value: number) {
  return Math.round(value * 10) / 10;
}

export type FitnessPageData = {
  signedIn: boolean;
  fitnessLoads: FitnessLoad[];
};

export const loadFitnessData = createServerFn({ method: "GET" }).handler(
  async (): Promise<FitnessPageData> => {
    const { loadFitnessDataImpl } = await import("./training-load.server.ts");
    return loadFitnessDataImpl();
  },
);
