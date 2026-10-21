import { subMonths } from "date-fns";

import {
  BPM_MAX,
  BPM_MIN,
  emptyHistogram,
  isPlausibleBpm,
  type HeartRateFamily,
  type HeartRateZoneStat,
} from "./heart-rate.ts";
import { normalizedPowerFromWatts } from "./normalized-power.ts";

/** Max HR falls with age, so only recent peaks set the anchor. */
export const MAX_HR_WINDOW_MONTHS = 18;
/** A peak this far above the age prediction is treated as a sensor spike. */
const ABOVE_AGE_LIMIT_BPM = 25;
/** A peak this far above every other peak, on an easy session, is treated as a sensor spike. */
const ISOLATED_GAP_BPM = 8;
const EASY_AVG_SHARE = 0.7;
const MAX_EXCLUDED = 3;
/** Observed vs age-predicted max within this many bpm reads as "matches". */
const AGE_MATCH_BPM = 10;

export type HeartPeak = {
  bpm: number;
  start: string;
  name?: string | null;
  /** Average HR of the same activity; tells a race peak from a spike on an easy day. */
  avgBpm?: number | null;
};

export type MaxHrAnchor = {
  bpm: number | null;
  /** `recent`: a peak inside the window. `older`: no recent peak, oldest data used. `age`: no peaks. */
  source: "recent" | "older" | "age" | null;
  predictedBpm: number | null;
  ageCheck: "matches" | "above" | "below" | null;
  peak: HeartPeak | null;
  excluded: (HeartPeak & { reason: "above-age" | "isolated" })[];
};

/** Tanaka et al. 2001: 208 − 0.7 × age. */
export function predictedMaxHr(age: number | null | undefined) {
  if (age == null || !Number.isFinite(age) || age < 10 || age > 100) return null;
  return Math.round(208 - 0.7 * age);
}

/** Only bike and run peaks are expected to reach a true max; swims and walks sit well below it. */
function checksAgainstAge(family: HeartRateFamily) {
  return family === "cycling" || family === "running";
}

export function estimateMaxHrAnchor(
  peaks: HeartPeak[],
  options: { family: HeartRateFamily; age?: number | null; now?: Date },
): MaxHrAnchor {
  const predictedBpm = predictedMaxHr(options.age);
  const plausible = peaks.filter((peak) => isPlausibleBpm(peak.bpm));
  const cutoff = subMonths(options.now ?? new Date(), MAX_HR_WINDOW_MONTHS).getTime();
  const recent = plausible.filter((peak) => new Date(peak.start).getTime() >= cutoff);
  const pool = recent.length ? recent : plausible;
  const source = recent.length ? "recent" : plausible.length ? "older" : null;

  const sorted = [...pool].sort((a, b) => b.bpm - a.bpm || b.start.localeCompare(a.start));
  const excluded: MaxHrAnchor["excluded"] = [];
  while (sorted.length && excluded.length < MAX_EXCLUDED) {
    const [top, next] = sorted;
    if (predictedBpm != null && top.bpm > predictedBpm + ABOVE_AGE_LIMIT_BPM) {
      excluded.push({ ...top, reason: "above-age" });
      sorted.shift();
      continue;
    }
    const easyDay = top.avgBpm != null && top.avgBpm > 0 && top.avgBpm < top.bpm * EASY_AVG_SHARE;
    if (next && top.bpm - next.bpm > ISOLATED_GAP_BPM && easyDay) {
      excluded.push({ ...top, reason: "isolated" });
      sorted.shift();
      continue;
    }
    break;
  }

  const peak = sorted[0] ?? null;
  const bpm = peak ? Math.round(peak.bpm) : predictedBpm;
  let ageCheck: MaxHrAnchor["ageCheck"] = null;
  if (peak && predictedBpm != null && checksAgainstAge(options.family)) {
    const diff = peak.bpm - predictedBpm;
    ageCheck = diff > AGE_MATCH_BPM ? "above" : diff < -AGE_MATCH_BPM ? "below" : "matches";
  }
  return {
    bpm,
    source: peak ? source : predictedBpm != null ? "age" : null,
    predictedBpm,
    ageCheck,
    peak,
    excluded,
  };
}

export function maxHrAnchorHint(anchor: MaxHrAnchor) {
  if (anchor.source === "age") return "From your age, no recorded peak";
  if (anchor.ageCheck === "below" && anchor.predictedBpm) {
    return `Age suggests ~${anchor.predictedBpm} bpm`;
  }
  if (anchor.ageCheck === "above" && anchor.predictedBpm) {
    return `Above age estimate (~${anchor.predictedBpm})`;
  }
  if (anchor.source === "older") return `No peak in the last ${MAX_HR_WINDOW_MONTHS} months`;
  return null;
}

export function maxHrAnchorInfo(anchor: MaxHrAnchor) {
  const parts = [
    `Highest heart rate from the last ${MAX_HR_WINDOW_MONTHS} months: max HR drops about 0.7 bpm per year, so older peaks would set zones too high.`,
  ];
  if (anchor.predictedBpm) {
    parts.push(`Your age predicts about ${anchor.predictedBpm} bpm (208 − 0.7 × age).`);
  } else {
    parts.push("Add your birth date in settings to check this against your age.");
  }
  if (anchor.ageCheck === "below") {
    parts.push(
      "Your recorded peak is well below that. If you have not gone all-out recently, your true max is probably higher and zones will read efforts as harder than they are.",
    );
  }
  if (anchor.ageCheck === "above") {
    parts.push("Your peak is above the age estimate. That is common for fit athletes.");
  }
  if (anchor.excluded.length) {
    parts.push(
      `Ignored as sensor spikes: ${anchor.excluded.map((peak) => `${Math.round(peak.bpm)} bpm${peak.name ? ` (${peak.name})` : ""}`).join(", ")}.`,
    );
  }
  return parts.join(" ");
}

/* ---------- Per-activity stream summary (cached next to the chart preview) ---------- */

/** Bump when the stored shape or the math changes, so cached rows are rebuilt on next view. */
export const HEART_ANALYSIS_VERSION = 2;

const MAX_INTERVAL_SEC = 30;
const STOPPED_SPEED_MS = 0.5;
const WARMUP_SEC = 10 * 60;
const MIN_DECOUPLING_SEC = 35 * 60;
const MAX_STEADY_VI = 1.15;
const MAX_STEADY_SPEED_CV = 0.15;
const MAX_STEADY_POWER_CV = 0.25;
/** Running speed is only comparable to HR on fairly flat routes. */
export const MAX_FLAT_GAIN_M_PER_KM = 15;

export type HeartStreams = {
  time: number[] | null;
  heartrate: number[] | null;
  watts: number[] | null;
  velocitySmooth: number[] | null;
  moving: boolean[] | null;
  temp: number[] | null;
};

export type DecouplingResult =
  | {
      status: "ok";
      output: "power" | "speed";
      /** Positive: HR rose against output in the second half. */
      pct: number;
      analysedSec: number;
      firstHalf: { avgHeartrate: number; avgOutput: number };
      secondHalf: { avgHeartrate: number; avgOutput: number };
    }
  | { status: "skipped"; reason: "no-heartrate" | "no-output" | "short" | "unsteady" | "hilly" };

/** FTP- and zone-independent heart summary of one activity. */
export type HeartAnalysis = {
  version: typeof HEART_ANALYSIS_VERSION;
  /** Sparse `[bpm, seconds]` pairs of time spent at each heart rate. */
  histogram: [number, number][];
  decoupling: DecouplingResult;
  /** Best sustained average HR per `PEAK_HR_DURATIONS` window; missing when the session is shorter. */
  peaks: SustainedHeartrate[];
  avgTempC: number | null;
};

export function isHeartAnalysis(value: unknown): value is HeartAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as HeartAnalysis;
  return analysis.version === HEART_ANALYSIS_VERSION && Array.isArray(analysis.histogram);
}

function sampleInterval(time: number[] | null, index: number) {
  if (!time || index === 0) return 1;
  const delta = (time[index] ?? 0) - (time[index - 1] ?? 0);
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.min(MAX_INTERVAL_SEC, delta);
}

function isMoving(streams: HeartStreams, index: number) {
  if (streams.moving) return streams.moving[index] !== false;
  const speed = streams.velocitySmooth?.[index];
  return speed == null || speed >= STOPPED_SPEED_MS;
}

export function histogramFromStreams(heartrate: number[] | null, time: number[] | null) {
  const histogram = emptyHistogram();
  if (!heartrate?.length) return histogram;
  for (let index = 0; index < heartrate.length; index += 1) {
    const bpm = Math.round(heartrate[index] ?? 0);
    if (!isPlausibleBpm(bpm)) continue;
    histogram[bpm] += sampleInterval(time, index) || 1;
  }
  return histogram;
}

export function sparseHistogram(histogram: number[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 1) {
    if ((histogram[bpm] ?? 0) > 0) pairs.push([bpm, histogram[bpm]]);
  }
  return pairs;
}

export function denseHistogram(pairs: [number, number][]) {
  const histogram = emptyHistogram();
  for (const [bpm, seconds] of pairs) {
    if (bpm >= BPM_MIN && bpm <= BPM_MAX) histogram[bpm] += seconds;
  }
  return histogram;
}

type DecouplingContext = {
  family: HeartRateFamily;
  /** Bike power is comparable to HR; run speed only on flat, outdoor runs. */
  sportType: string;
  distance: number | null;
  totalElevationGain: number | null;
};

function weightedMean(values: number[], weights: number[]) {
  let sum = 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] * weights[index];
    total += weights[index];
  }
  return total > 0 ? sum / total : 0;
}

/** Coefficient of variation of 60 s means: for run speed, and for power when NP is unavailable. */
function outputVariation(values: number[], weights: number[]) {
  const bins: number[] = [];
  let binSum = 0;
  let binSec = 0;
  for (let index = 0; index < values.length; index += 1) {
    binSum += values[index] * weights[index];
    binSec += weights[index];
    if (binSec >= 60) {
      bins.push(binSum / binSec);
      binSum = 0;
      binSec = 0;
    }
  }
  if (bins.length < 4) return null;
  const mean = bins.reduce((sum, value) => sum + value, 0) / bins.length;
  if (mean <= 0) return null;
  const variance = bins.reduce((sum, value) => sum + (value - mean) ** 2, 0) / bins.length;
  return Math.sqrt(variance) / mean;
}

export function isFlatEnough(distance: number | null, gain: number | null) {
  if (!distance || distance <= 0) return false;
  return (gain ?? 0) / (distance / 1000) <= MAX_FLAT_GAIN_M_PER_KM;
}

/**
 * Aerobic decoupling (Friel's Pa:HR / Pw:HR): output per heartbeat in the first half of the
 * session after warm-up vs the second half. Only steady sessions say anything about endurance.
 */
export function computeDecoupling(
  streams: HeartStreams,
  context: DecouplingContext,
): DecouplingResult {
  const heartrate = streams.heartrate;
  if (!heartrate?.some((value) => isPlausibleBpm(value))) {
    return { status: "skipped", reason: "no-heartrate" };
  }
  const usePower =
    context.family === "cycling" && Boolean(streams.watts?.some((value) => value > 0));
  const useSpeed = context.sportType === "Run" && Boolean(streams.velocitySmooth?.length);
  if (!usePower && !useSpeed) return { status: "skipped", reason: "no-output" };
  if (useSpeed && !isFlatEnough(context.distance, context.totalElevationGain)) {
    return { status: "skipped", reason: "hilly" };
  }
  const output = usePower ? streams.watts! : streams.velocitySmooth!;

  const hrs: number[] = [];
  const outputs: number[] = [];
  const weights: number[] = [];
  const times: number[] = [];
  let movingSec = 0;
  for (let index = 0; index < heartrate.length; index += 1) {
    const dt = sampleInterval(streams.time, index);
    if (dt <= 0 || !isMoving(streams, index)) continue;
    movingSec += dt;
    if (movingSec <= WARMUP_SEC) continue;
    const bpm = heartrate[index];
    const value = output[index];
    if (!isPlausibleBpm(bpm) || value == null || !Number.isFinite(value)) continue;
    hrs.push(bpm);
    outputs.push(Math.max(0, value));
    weights.push(dt);
    times.push(movingSec);
  }
  const analysedSec = weights.reduce((sum, value) => sum + value, 0);
  if (analysedSec < MIN_DECOUPLING_SEC) return { status: "skipped", reason: "short" };

  if (usePower) {
    const avg = weightedMean(outputs, weights);
    const np = normalizedPowerFromWatts(outputs, times);
    // Sparse streams (10 s samples) give no 30 s NP windows; fall back to minute-to-minute spread.
    const steady = np
      ? np / avg <= MAX_STEADY_VI
      : (outputVariation(outputs, weights) ?? Infinity) <= MAX_STEADY_POWER_CV;
    if (!avg || !steady) return { status: "skipped", reason: "unsteady" };
  } else {
    const cv = outputVariation(outputs, weights);
    if (cv == null || cv > MAX_STEADY_SPEED_CV) return { status: "skipped", reason: "unsteady" };
  }

  let elapsed = 0;
  let split = 0;
  while (split < weights.length && elapsed < analysedSec / 2) {
    elapsed += weights[split];
    split += 1;
  }
  const half = (from: number, to: number) => ({
    avgHeartrate: weightedMean(hrs.slice(from, to), weights.slice(from, to)),
    avgOutput: weightedMean(outputs.slice(from, to), weights.slice(from, to)),
  });
  const firstHalf = half(0, split);
  const secondHalf = half(split, weights.length);
  if (!firstHalf.avgHeartrate || !secondHalf.avgHeartrate || !firstHalf.avgOutput) {
    return { status: "skipped", reason: "unsteady" };
  }
  const firstEf = firstHalf.avgOutput / firstHalf.avgHeartrate;
  const secondEf = secondHalf.avgOutput / secondHalf.avgHeartrate;
  const pct = ((firstEf - secondEf) / firstEf) * 100;
  const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
  return {
    status: "ok",
    output: usePower ? "power" : "speed",
    pct: round(pct),
    analysedSec: Math.round(analysedSec),
    firstHalf: {
      avgHeartrate: round(firstHalf.avgHeartrate),
      avgOutput: round(firstHalf.avgOutput, 2),
    },
    secondHalf: {
      avgHeartrate: round(secondHalf.avgHeartrate),
      avgOutput: round(secondHalf.avgOutput, 2),
    },
  };
}

function meanTemp(temp: number[] | null) {
  if (!temp?.length) return null;
  const values = temp.filter((value) => Number.isFinite(value) && value > -40 && value < 60);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/** Windows a sustained heart rate is reported for: a hard minute, a VO2 effort, a threshold test. */
export const PEAK_HR_DURATIONS = [60, 300, 1200] as const;

export type SustainedHeartrate = { seconds: number; bpm: number };

/**
 * Highest time-weighted average heart rate over each window, so a single spike does not read
 * as an effort. Implausible samples and recording gaps (capped like the histogram) count as
 * missing time rather than as low heart rate.
 */
export function peakSustainedHeartrates(
  heartrate: number[] | null,
  time: number[] | null,
  durations: readonly number[] = PEAK_HR_DURATIONS,
): SustainedHeartrate[] {
  if (!heartrate?.length) return [];
  const bpms: number[] = [];
  const weights: number[] = [];
  for (let index = 0; index < heartrate.length; index += 1) {
    const bpm = heartrate[index];
    const dt = sampleInterval(time, index) || 1;
    if (!isPlausibleBpm(bpm)) continue;
    bpms.push(bpm);
    weights.push(dt);
  }
  const results: SustainedHeartrate[] = [];
  for (const seconds of durations) {
    let best = 0;
    let from = 0;
    let sum = 0;
    let span = 0;
    for (let to = 0; to < bpms.length; to += 1) {
      sum += bpms[to] * weights[to];
      span += weights[to];
      while (span - weights[from] >= seconds) {
        sum -= bpms[from] * weights[from];
        span -= weights[from];
        from += 1;
      }
      if (span >= seconds) best = Math.max(best, sum / span);
    }
    if (best > 0) results.push({ seconds, bpm: Math.round(best) });
  }
  return results;
}

export function buildHeartAnalysis(
  streams: HeartStreams,
  context: DecouplingContext,
): HeartAnalysis {
  return {
    version: HEART_ANALYSIS_VERSION,
    histogram: sparseHistogram(histogramFromStreams(streams.heartrate, streams.time)),
    decoupling: computeDecoupling(streams, context),
    peaks: peakSustainedHeartrates(streams.heartrate, streams.time),
    avgTempC: meanTemp(streams.temp),
  };
}

export function decouplingLabel(pct: number) {
  if (pct < -5) return "HR fell against output";
  if (pct < 5) return "Coupled";
  if (pct <= 10) return "Some drift";
  return "Large drift";
}

export function decouplingInfo(result: DecouplingResult) {
  if (result.status === "ok") {
    const pct = result.pct;
    if (pct < -5) {
      return "Output per heartbeat rose in the second half. Usually a slow warm-up or a stronger second half, not a fitness signal.";
    }
    if (pct < 5) {
      return "Under 5 % means heart rate held steady against output: your aerobic base covers this duration.";
    }
    if (pct <= 10) {
      return "5–10 % means heart rate crept up against output. Common on long sessions, in heat, or when underfueled.";
    }
    return "Over 10 % means heart rate rose a lot against output. The session was longer or harder than your current aerobic endurance, or heat and fuel played a part.";
  }
  const reasons: Record<typeof result.reason, string> = {
    "no-heartrate": "Needs heart-rate samples.",
    "no-output": "Needs bike power or a flat outdoor run to compare heart rate against.",
    short: "Needs at least 45 minutes of moving time, including a 10-minute warm-up.",
    unsteady: "Only steady sessions count. Intervals and surgy rides swing heart rate by design.",
    hilly: "Run speed only compares to heart rate on fairly flat routes.",
  };
  return reasons[result.reason];
}

/* ---------- Efficiency factor and "usual" heart rate ---------- */

const MIN_EF_SECONDS = 20 * 60;
const MIN_EF_HEARTRATE = 90;
export const EF_NORM_DAYS = 42;
export const USUAL_HR_DAYS = 90;
const MIN_NORM_POINTS = 3;
const MIN_MODEL_POINTS = 6;
const MIN_MODEL_R = 0.3;
/** How far past the outputs seen the line may still be read. */
const RANGE_MARGIN = 0.05;
/** Aerobic sessions stay below the top of zone 3 in both the Coggan and Friel models. */
const AEROBIC_LTHR_SHARE = 0.94;

const POWER_EF_SPORTS = new Set([
  "Ride",
  "VirtualRide",
  "GravelRide",
  "MountainBikeRide",
  "Velomobile",
  "Handcycle",
]);

export type EfficiencyKind = "power" | "speed";

export type EfficiencyInput = {
  sportType: string;
  movingTime: number;
  distance: number | null;
  totalElevationGain: number | null;
  averageHeartrate: number | null;
  averageWatts: number | null;
  weightedAverageWatts: number | null;
  deviceWatts: boolean;
};

export type EfficiencyPoint = {
  start: string;
  /** Output per heartbeat: W/bpm for rides, m/min per bpm for runs. */
  ef: number;
  output: number;
  avgHeartrate: number;
  aerobic: boolean;
};

export function efficiencyKindFor(sportType: string): EfficiencyKind | null {
  if (POWER_EF_SPORTS.has(sportType)) return "power";
  if (sportType === "Run") return "speed";
  return null;
}

/** Normalized power (or speed on flat runs) per heartbeat, from activity summaries. */
export function efficiencyFactor(input: EfficiencyInput) {
  const kind = efficiencyKindFor(input.sportType);
  const hr = input.averageHeartrate;
  if (!kind || input.movingTime < MIN_EF_SECONDS) return null;
  if (hr == null || !isPlausibleBpm(hr) || hr < MIN_EF_HEARTRATE) return null;
  let output: number | null = null;
  if (kind === "power") {
    if (!input.deviceWatts) return null;
    output = input.weightedAverageWatts ?? input.averageWatts;
  } else {
    if (!isFlatEnough(input.distance, input.totalElevationGain)) return null;
    output = input.distance ? input.distance / (input.movingTime / 60) : null;
  }
  if (output == null || !Number.isFinite(output) || output <= 0) return null;
  return { kind, output, ef: output / hr };
}

export function isAerobicSession(avgHeartrate: number, lthr: number | null) {
  return lthr == null || avgHeartrate <= lthr * AEROBIC_LTHR_SHARE;
}

export function toEfficiencyPoint(
  input: EfficiencyInput & { start: string },
  lthr: number | null,
): EfficiencyPoint | null {
  const result = efficiencyFactor(input);
  if (!result || input.averageHeartrate == null) return null;
  return {
    start: input.start,
    ef: Math.round(result.ef * 1000) / 1000,
    output: Math.round(result.output * 10) / 10,
    avgHeartrate: input.averageHeartrate,
    aerobic: isAerobicSession(input.averageHeartrate, lthr),
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function priorPoints(points: EfficiencyPoint[], beforeIso: string, days: number) {
  const before = new Date(beforeIso).getTime();
  const from = before - days * 86_400_000;
  return points.filter((point) => {
    const at = new Date(point.start).getTime();
    return point.aerobic && at < before && at >= from;
  });
}

/** Median aerobic EF in the weeks before an activity. */
export function efficiencyNorm(points: EfficiencyPoint[], beforeIso: string) {
  const prior = priorPoints(points, beforeIso, EF_NORM_DAYS);
  if (prior.length < MIN_NORM_POINTS) return null;
  const value = median(prior.map((point) => point.ef));
  return value == null ? null : { value: Math.round(value * 1000) / 1000, count: prior.length };
}

/**
 * Average HR this athlete usually needs for a given output: a least-squares line through
 * recent aerobic sessions. Null when there are too few sessions, the relation is weak,
 * or the output is more than 5 % outside the range seen.
 */
export function usualHeartrate(points: EfficiencyPoint[], beforeIso: string, output: number) {
  const prior = priorPoints(points, beforeIso, USUAL_HR_DAYS);
  if (prior.length < MIN_MODEL_POINTS) return null;
  const xs = prior.map((point) => point.output);
  const ys = prior.map((point) => point.avgHeartrate);
  if (
    output < Math.min(...xs) * (1 - RANGE_MARGIN) ||
    output > Math.max(...xs) * (1 + RANGE_MARGIN)
  ) {
    return null;
  }
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let index = 0; index < n; index += 1) {
    sxx += (xs[index] - meanX) ** 2;
    sxy += (xs[index] - meanX) * (ys[index] - meanY);
    syy += (ys[index] - meanY) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return null;
  const slope = sxy / sxx;
  const r = sxy / Math.sqrt(sxx * syy);
  if (slope <= 0 || r < MIN_MODEL_R) return null;
  return { bpm: Math.round(meanY + slope * (output - meanX)), count: n };
}

/* ---------- Activity heart card ---------- */

export type ActivityHeart = {
  family: HeartRateFamily;
  zoneModel: string;
  maxHeartrate: number | null;
  lthr: number | null;
  /** Null when the activity has no heart-rate stream. */
  zones: HeartRateZoneStat[] | null;
  zoneSeconds: number;
  decoupling: DecouplingResult | null;
  efficiency: {
    kind: EfficiencyKind;
    value: number;
    aerobic: boolean;
    norm: { value: number; count: number } | null;
    deltaPct: number | null;
  } | null;
  usual: { expectedBpm: number; gapBpm: number; count: number } | null;
  peaks: SustainedHeartrate[];
  avgTempC: number | null;
};

export function formatEfficiency(value: number, kind: EfficiencyKind) {
  return kind === "power" ? `${value.toFixed(2)} W/bpm` : `${value.toFixed(2)} m/min/bpm`;
}

const HOT_C = 25;
const FATIGUED_TSB = -10;
const DEEP_FATIGUE_TSB = -20;
const GAP_BPM = 5;

export type HeartContext = {
  tone: "neutral" | "warning" | "positive";
  title: string;
  detail: string;
};

/** Explains a heart rate that differs from usual with form and heat, so it is not just a number. */
export function explainHeartGap(input: {
  gapBpm: number;
  tsb: number | null;
  tempC: number | null;
}): HeartContext {
  const { gapBpm, tsb, tempC } = input;
  const formText = tsb == null ? null : `form was ${Math.round(tsb)}`;
  const hot = tempC != null && tempC >= HOT_C;
  if (gapBpm >= GAP_BPM) {
    if (tsb != null && tsb <= FATIGUED_TSB) {
      return {
        tone: "warning",
        title: "Higher than usual: fatigue",
        detail: `Heart rate ran ${gapBpm} bpm above your usual for this output and ${formText}. Accumulated fatigue often raises heart rate at easy efforts. Keep the next days easy.`,
      };
    }
    if (hot) {
      return {
        tone: "neutral",
        title: "Higher than usual: heat",
        detail: `Heart rate ran ${gapBpm} bpm above your usual for this output at ${Math.round(tempC)} °C. Heat raises heart rate for the same work.`,
      };
    }
    return {
      tone: "warning",
      title: "Higher than usual",
      detail: `Heart rate ran ${gapBpm} bpm above your usual for this output${formText ? ` while ${formText}` : ""}. Load and heat do not explain it. Poor sleep, stress, dehydration, or an oncoming illness can.`,
    };
  }
  if (gapBpm <= -GAP_BPM) {
    if (tsb != null && tsb <= DEEP_FATIGUE_TSB) {
      return {
        tone: "warning",
        title: "Lower than usual while fatigued",
        detail: `Heart rate ran ${-gapBpm} bpm below your usual for this output and ${formText}. A heart rate that will not rise under deep fatigue can be a sign of overreaching.`,
      };
    }
    return {
      tone: "positive",
      title: "Lower than usual",
      detail: `Heart rate ran ${-gapBpm} bpm below your usual for this output${formText ? ` and ${formText}` : ""}. Fresh legs or improving aerobic fitness.`,
    };
  }
  return {
    tone: "neutral",
    title: "In line with usual",
    detail: `Heart rate was within ${GAP_BPM} bpm of your usual for this output${formText ? `; ${formText}` : ""}.`,
  };
}

/* ---------- Efficiency trend vs fitness ---------- */

export type EfficiencyWeek = { week: string; ef: number; count: number; ctl: number | null };

export function efficiencyTrendSummary(weeks: EfficiencyWeek[]) {
  const withCtl = weeks.filter((week) => week.ctl != null);
  if (weeks.length < 4 || withCtl.length < 2) return null;
  const half = Math.floor(weeks.length / 2);
  const first = median(weeks.slice(0, half).map((week) => week.ef));
  const last = median(weeks.slice(half).map((week) => week.ef));
  if (!first || !last) return null;
  const efPct = Math.round(((last - first) / first) * 1000) / 10;
  const ctlChange = Math.round((withCtl.at(-1)!.ctl! - withCtl[0].ctl!) * 10) / 10;
  const efUp = efPct >= 2;
  const efDown = efPct <= -2;
  const ctlUp = ctlChange >= 3;
  const ctlDown = ctlChange <= -3;
  let text: string;
  if (ctlUp && efUp) {
    text = "Fitness and efficiency are both rising: the extra load is turning into aerobic gains.";
  } else if (ctlUp && efDown) {
    text =
      "Fitness is rising but you produce less per heartbeat. Some dip is normal in a hard block; if it lasts, add easy volume or recovery.";
  } else if (ctlUp) {
    text =
      "Fitness is rising but efficiency is flat. Aerobic gains often lag load by a few weeks; keep most of the volume easy.";
  } else if (ctlDown && efDown) {
    text = "Fitness and efficiency are both falling: consistent with less training.";
  } else if (efUp) {
    text = "Efficiency is rising at steady or lower load: fresher legs or aerobic adaptation.";
  } else if (efDown) {
    text =
      "Efficiency is falling without a rise in load. Check for heat, fatigue, illness, or changing sensors.";
  } else {
    text = "Fitness and efficiency are both steady.";
  }
  return { efPct, ctlChange, text };
}
