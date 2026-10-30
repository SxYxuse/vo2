import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay, subDays, subMonths, subYears } from "date-fns";
import { createServerFn } from "@tanstack/react-start";

import { estimateMaxHrAnchor, type HeartPeak } from "./heart-insights.ts";
import type { HeartRateSettings } from "./heart-rate-settings.ts";
import type { Goal } from "./season.types.ts";
import {
  heartRateFamily,
  isPlausibleBpm,
  isZonedFamily,
  type HeartRateFamily,
  type ZonedFamily,
} from "./heart-rate.ts";
import {
  LTHR_MIN_SECONDS,
  LTHR_WINDOW_DAYS,
  estimateLthr,
  thresholdEffort,
} from "./lthr-estimate.ts";
import { dayKey } from "./day-key.ts";
import { normalizedPowerFromWatts } from "./normalized-power.ts";

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
export const DEFAULT_REST_HR = 60;
const DAY_MS = 86_400_000;

export type LoadSource = "power" | "heartRate" | "similarHeartRate" | "duration";

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
  /** Peaks older than the max-HR window stop setting zones; missing counts as recent. */
  startDate?: Date | string;
  movingTime: number;
  /** Metres; lets HR estimates match activities of similar speed. */
  distance?: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageWatts: number | null;
  weightedAverageWatts: number | null;
  deviceWatts: boolean;
  wattsStream?: number[] | null;
  /** Attached only to recent activities that could hold a threshold effort. */
  heartrateStream?: number[] | null;
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

export type AnchorOptions = { age?: number | null; now?: Date; heartRate?: HeartRateSettings };

function athleteMaxHr(family: HeartRateFamily, settings: HeartRateSettings | undefined) {
  return isZonedFamily(family) ? (settings?.sports[family].maxHr ?? null) : null;
}

/** Recent max HR per family, with sensor spikes dropped (same rules as the heart rate page). */
function peakByFamily(activities: LoadInputs[], options: AnchorOptions) {
  const peaks: Record<HeartRateFamily, HeartPeak[]> = {
    cycling: [],
    running: [],
    swimming: [],
    walking: [],
    other: [],
  };
  const now = options.now ?? new Date();
  for (const activity of activities) {
    const maxHr = activity.maxHeartrate ?? 0;
    if (!isPlausibleBpm(maxHr)) continue;
    const start = activity.startDate ? new Date(activity.startDate) : now;
    peaks[heartRateFamily(activity.sportType)].push({
      bpm: maxHr,
      start: start.toISOString(),
      avgBpm: activity.averageHeartrate,
    });
  }
  const observed = (family: HeartRateFamily) => {
    const anchor = estimateMaxHrAnchor(peaks[family], {
      family,
      age: options.age,
      now,
      athleteBpm: athleteMaxHr(family, options.heartRate),
    });
    return anchor.peak || anchor.source === "athlete" ? anchor.bpm : null;
  };
  return {
    cyclingMaxHr: observed("cycling"),
    runMaxHr: observed("running"),
    swimMaxHr: observed("swimming"),
    walkingMaxHr: observed("walking"),
    otherMaxHr: observed("other"),
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

/** Whether an activity's heart-rate stream can feed the LTHR estimate. */
export function couldHoldThreshold(
  activity: Pick<LoadInputs, "sportType" | "movingTime" | "startDate">,
  now = new Date(),
) {
  if (activity.movingTime < LTHR_MIN_SECONDS) return false;
  if (!isZonedFamily(heartRateFamily(activity.sportType))) return false;
  const start = activity.startDate ? new Date(activity.startDate).getTime() : now.getTime();
  return start >= now.getTime() - LTHR_WINDOW_DAYS * DAY_MS;
}

function lthrByFamily(
  activities: LoadInputs[],
  peaks: ReturnType<typeof peakByFamily>,
  options: AnchorOptions,
) {
  const maxHr: Record<ZonedFamily, number | null> = {
    cycling: peaks.cyclingMaxHr,
    running: peaks.runMaxHr,
    swimming: peaks.swimMaxHr,
  };
  const efforts: Record<ZonedFamily, number[]> = { cycling: [], running: [], swimming: [] };
  for (const activity of activities) {
    if (!activity.heartrateStream || !couldHoldThreshold(activity, options.now)) continue;
    const family = heartRateFamily(activity.sportType) as ZonedFamily;
    const familyMax = maxHr[family];
    if (familyMax == null) continue;
    const bpm = thresholdEffort(activity.heartrateStream, activity.timeStream, familyMax);
    if (bpm != null) efforts[family].push(bpm);
  }
  return {
    cyclingLthr: estimateLthr(efforts.cycling, maxHr.cycling, "cycling"),
    runLthr: estimateLthr(efforts.running, maxHr.running, "running"),
    swimLthr: estimateLthr(efforts.swimming, maxHr.swimming, "swimming"),
  };
}

export function estimateLoadAnchors(
  activities: LoadInputs[],
  options: AnchorOptions = {},
): LoadAnchors {
  const peaks = peakByFamily(activities, options);
  return {
    ftp: estimateFtp(activities),
    ...lthrByFamily(activities, peaks, options),
    restHr: estimateRestHr(activities),
    ...peaks,
  };
}

/** Estimates with the athlete's set LTHR and resting heart rate laid over; the zone method plays no part. */
export function withAthleteAnchors(
  anchors: LoadAnchors,
  settings: HeartRateSettings | undefined,
): LoadAnchors {
  if (!settings) return anchors;
  return {
    ...anchors,
    cyclingLthr: settings.sports.cycling.lthr ?? anchors.cyclingLthr,
    runLthr: settings.sports.running.lthr ?? anchors.runLthr,
    swimLthr: settings.sports.swimming.lthr ?? anchors.swimLthr,
    restHr: settings.restHr ?? anchors.restHr,
  };
}

function hrCeiling(sportType: string, anchors: LoadAnchors) {
  return sportLthr(sportType, anchors) ?? sportMaxHr(sportType, anchors);
}

function hrIntensity(activity: LoadInputs, anchors: LoadAnchors) {
  const avg = activity.averageHeartrate;
  if (avg == null || avg <= 0) return null;
  const rest = Math.round(anchors.restHr);
  const ceiling = hrCeiling(activity.sportType, anchors);
  if (ceiling == null || ceiling <= rest) return null;
  return (avg - rest) / (ceiling - rest);
}

const SIMILAR_HR_NEIGHBOURS = 5;
/** Fewer matches than this and one bad sensor day would set the estimate; duration is safer. */
const SIMILAR_HR_MIN_MATCHES = 3;
/** Heart rate at a given effort drifts with fitness, so only sessions this close in time count. */
export const SIMILAR_HR_WINDOW_DAYS = 60;

function averageSpeed(activity: LoadInputs) {
  if (!activity.distance || activity.distance <= 0 || activity.movingTime <= 0) return null;
  return activity.distance / activity.movingTime;
}

function startMs(activity: LoadInputs) {
  return activity.startDate ? new Date(activity.startDate).getTime() : null;
}

function daysApart(activity: LoadInputs, other: LoadInputs) {
  const start = startMs(activity);
  const otherStart = startMs(other);
  if (start == null || otherStart == null) return 0;
  return Math.abs(start - otherStart) / DAY_MS;
}

/**
 * Walks borrow from walks and rides from rides: a run's intensity would score a walk far too
 * hard. Mixed sports only borrow from the same sport type, since yoga says nothing about a gym session.
 */
function canLendHeartRate(activity: LoadInputs, other: LoadInputs) {
  const family = heartRateFamily(activity.sportType);
  if (family === "other") return other.sportType === activity.sportType;
  return heartRateFamily(other.sportType) === family;
}

/** How unlike two activities of one sport group are: duration, speed, time apart, sport type. */
function dissimilarity(activity: LoadInputs, other: LoadInputs) {
  let score = Math.abs(Math.log(activity.movingTime / other.movingTime));
  score += daysApart(activity, other) / SIMILAR_HR_WINDOW_DAYS / 2;
  const speed = averageSpeed(activity);
  const otherSpeed = averageSpeed(other);
  if (speed && otherSpeed) score += 2 * Math.abs(Math.log(speed / otherSpeed));
  if (activity.sportType !== other.sportType) score += 0.5;
  return score;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Heart-rate intensity (share of heart-rate reserve up to LTHR or max) borrowed from the
 * athlete's most similar sessions of the same sport group within two months either side.
 * The median keeps one bad sensor day from setting the estimate; with fewer than three
 * matches there is no estimate and duration scores the session.
 */
export function estimateHrIntensity(
  activity: LoadInputs,
  pool: LoadInputs[],
  anchors: LoadAnchors,
) {
  if (activity.movingTime <= 0) return null;
  const neighbours: { intensity: number; score: number }[] = [];
  for (const other of pool) {
    if (
      other === activity ||
      other.movingTime <= 0 ||
      !isPlausibleBpm(other.averageHeartrate) ||
      !canLendHeartRate(activity, other) ||
      daysApart(activity, other) > SIMILAR_HR_WINDOW_DAYS
    ) {
      continue;
    }
    const intensity = hrIntensity(other, anchors);
    if (intensity == null || intensity <= 0) continue;
    neighbours.push({ intensity, score: dissimilarity(activity, other) });
  }
  if (neighbours.length < SIMILAR_HR_MIN_MATCHES) return null;
  const nearest = neighbours.sort((a, b) => a.score - b.score).slice(0, SIMILAR_HR_NEIGHBOURS);
  return median(nearest.map((neighbour) => neighbour.intensity));
}

export type ActivityLoad = {
  load: number;
  source: LoadSource;
  /** Average HR implied by the borrowed intensity; only set when source is "similarHeartRate". */
  estimatedHeartrate: number | null;
};

export function activityTrainingLoad(
  activity: LoadInputs,
  anchors: LoadAnchors,
  /** Activities to borrow heart-rate intensity from when this one has none. */
  pool: LoadInputs[] = [],
): ActivityLoad {
  const hours = hoursFromMoving(activity.movingTime);
  if (hours <= 0) return { load: 0, source: "duration", estimatedHeartrate: null };

  if (anchors.ftp && isPowerCyclingSport(activity.sportType) && activity.deviceWatts) {
    const normalized =
      activity.weightedAverageWatts ??
      normalizedPowerFromWatts(activity.wattsStream, activity.timeStream);
    if (normalized && normalized > 0) {
      return {
        load: trainingStress(hours, normalized / anchors.ftp),
        source: "power",
        estimatedHeartrate: null,
      };
    }
  }

  const intensity = hrIntensity(activity, anchors);
  if (intensity != null) {
    return {
      load: trainingStress(hours, intensity),
      source: "heartRate",
      estimatedHeartrate: null,
    };
  }

  if (!isPlausibleBpm(activity.averageHeartrate)) {
    const borrowed = estimateHrIntensity(activity, pool, anchors);
    if (borrowed != null) {
      const rest = Math.round(anchors.restHr);
      const ceiling = hrCeiling(activity.sportType, anchors);
      return {
        load: trainingStress(hours, borrowed),
        source: "similarHeartRate",
        estimatedHeartrate:
          ceiling != null && ceiling > rest ? Math.round(rest + borrowed * (ceiling - rest)) : null,
      };
    }
  }

  return {
    load: trainingStress(hours, durationIntensity(activity.sportType)),
    source: "duration",
    estimatedHeartrate: null,
  };
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
    estimatedLoad: source === "duration" || source === "similarHeartRate" ? load : 0,
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

  let firstMs = Infinity;
  for (const sample of loads) firstMs = Math.min(firstMs, Date.parse(sample.start));
  const first = zonedDayStart(new Date(firstMs), timeZone);
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

/** Form aligned with fitness and fatigue on the same point (after that day's known load). */
export function pmcWithCurrentForm(points: PmcPoint[]): PmcPoint[] {
  return points.map((point) => ({ ...point, tsb: formAfterLoad(point) }));
}

export function ctlChange(points: PmcPoint[], days = 7) {
  if (points.length < 2) return 0;
  const latest = points[points.length - 1];
  const prior = points[Math.max(0, points.length - 1 - days)];
  return latest.ctl - prior.ctl;
}

/** First instant of a period in the athlete's timezone; null for all time. */
export function periodStartMs(period: FitnessPeriod, timeZone: string, now = new Date()) {
  if (period === "all") return null;
  const end = zonedDayStart(now, timeZone);
  const start =
    period === "7d"
      ? subDays(end, 6)
      : period === "1y"
        ? subYears(end, 1)
        : subMonths(end, period === "1m" ? 1 : period === "3m" ? 3 : 6);
  return start.getTime();
}

export function slicePmc(points: PmcPoint[], period: FitnessPeriod, timeZone: string) {
  const startMs = periodStartMs(period, timeZone);
  if (!points.length || startMs == null) return points;
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

export type TrainingPhaseId =
  | "starting"
  | "deep-fatigue"
  | "ramping-fast"
  | "building"
  | "holding"
  | "fresh"
  | "recovering"
  | "break";

export type TrainingPhase = {
  id: TrainingPhaseId;
  title: string;
  detail: string;
  tone: "positive" | "neutral" | "warning";
};

/** A ramp below this, either way, reads as steady load. */
const STEADY_RAMP = 2;
const FAST_RAMP = 8;
const DEEP_FATIGUE_TSB = -30;
const FRESH_TSB = 10;
/** A four-week drop of a fifth of fitness (and at least 5) is a break, not a recovery week. */
const BREAK_SHARE = 0.2;
const MIN_HISTORY_DAYS = 28;

/**
 * Where the athlete is in the build, rest, and freshen cycle, from the last week's ramp, the
 * last four weeks' trend, and form. Fitness is meant to rise in blocks and dip in recovery,
 * so a falling line is a phase to read, not a loss to avoid.
 */
export function trainingPhase(points: PmcPoint[]): TrainingPhase {
  const latest = points.at(-1);
  if (!latest || points.length < MIN_HISTORY_DAYS || latest.ctl < 3) {
    return {
      id: "starting",
      title: "Building history",
      detail:
        "Fitness needs about six weeks of training to settle. Read the trend once there is more history.",
      tone: "neutral",
    };
  }
  const ramp = ctlChange(points, 7);
  const monthAgo = points[points.length - 1 - MIN_HISTORY_DAYS].ctl;
  const monthDrop = monthAgo - latest.ctl;
  const tsb = formAfterLoad(latest);
  const rampText = `${ramp >= 0 ? "+" : ""}${roundLoad(ramp).toFixed(1)}`;

  if (tsb < DEEP_FATIGUE_TSB) {
    return {
      id: "deep-fatigue",
      title: "Deep fatigue",
      detail: `Form is ${Math.round(tsb)}: recent load is far above what you are used to. Plan easy days soon so it turns into fitness instead of a hole.`,
      tone: "warning",
    };
  }
  if (ramp > FAST_RAMP) {
    return {
      id: "ramping-fast",
      title: "Ramping fast",
      detail: `Fitness rose ${rampText} this week. Fine for a week or a camp; hold it longer and fatigue tends to outrun the gains.`,
      tone: "warning",
    };
  }
  if (ramp >= STEADY_RAMP) {
    return {
      id: "building",
      title: "Building",
      detail: `Fitness rose ${rampText} this week and fatigue rises with it, so negative form is expected. Keep it up while sessions still feel good, then ease off for a few days.`,
      tone: "positive",
    };
  }
  if (monthDrop >= Math.max(5, monthAgo * BREAK_SHARE) && ramp < 0) {
    return {
      id: "break",
      title: "Taking a break",
      detail: `Fitness is ${Math.round(monthDrop)} lower than four weeks ago. It comes back quickly: ramp up again gently, a few points a week.`,
      tone: "neutral",
    };
  }
  if (ramp <= -STEADY_RAMP) {
    return tsb >= FRESH_TSB
      ? {
          id: "fresh",
          title: "Fresh",
          detail:
            "You eased off and fatigue has cleared. A good time for a race, a hard session, or a best effort.",
          tone: "positive",
        }
      : {
          id: "recovering",
          title: "Recovering",
          detail:
            "You eased off: fitness dips a little while fatigue clears. That is how the load you did turns into progress.",
          tone: "neutral",
        };
  }
  return {
    id: "holding",
    title: "Consolidating",
    detail:
      "Load is steady. You keep progressing as your body absorbs it; add load again once the same sessions feel easier.",
    tone: "neutral",
  };
}

export function roundLoad(value: number) {
  return Math.round(value * 10) / 10;
}

export type FitnessPageData = {
  signedIn: boolean;
  fitnessLoads: FitnessLoad[];
  /** Season goals, marked on the chart; the next one gets a race-day projection. */
  goals: Goal[];
};

export const loadFitnessData = createServerFn({ method: "GET" }).handler(
  async (): Promise<FitnessPageData> => {
    const { loadFitnessDataImpl } = await import("./training-load.server.ts");
    return loadFitnessDataImpl();
  },
);

export { dayKey };
