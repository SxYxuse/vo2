import { bandIndexForGrade, GRADE_BANDS } from "./grade-bands.ts";
import { normalizedPowerFromWatts } from "./normalized-power.ts";
import { isPowerCyclingSport } from "./training-load.ts";

/** Bump when the stored shape or the math changes, so cached rows are rebuilt on next view. */
export const RIDE_ANALYSIS_VERSION = 1;

/** Longest gap one sample may stand for; longer gaps are recording dropouts, not riding. */
const MAX_INTERVAL_SEC = 30;
/** Below this speed a sample counts as stopped when Strava sent no `moving` stream. */
const STOPPED_SPEED_MS = 0.5;
/** Half-window (samples) for deriving grade from altitude and distance. */
const GRADE_HALF_WINDOW = 5;
const MIN_GRADE_DISTANCE_M = 10;
const MIN_BAND_SEC = 30;

export type RideStreams = {
  time: number[] | null;
  distance: number[] | null;
  altitude: number[] | null;
  gradeSmooth: number[] | null;
  watts: number[] | null;
  cadence: number[] | null;
  velocitySmooth: number[] | null;
  heartrate: number[] | null;
  moving: boolean[] | null;
};

export type RideGradeBand = {
  label: string;
  minGrade: number;
  maxGrade: number;
  durationSec: number;
  distanceM: number | null;
  /** Includes coasting zeros, like Strava's average power. */
  avgWatts: number | null;
  /** Pedaling only: coasting zeros are left out. */
  avgCadence: number | null;
  avgSpeedKmh: number | null;
  avgHeartrate: number | null;
  coastingPct: number | null;
};

/** FTP-independent ride breakdown, cached next to the chart preview. */
export type RideAnalysis = {
  version: typeof RIDE_ANALYSIS_VERSION;
  hasPower: boolean;
  hasCadence: boolean;
  movingSec: number;
  avgWatts: number | null;
  normalizedWatts: number | null;
  coastingSec: number | null;
  bands: RideGradeBand[];
};

export type RideSummary = {
  hasPower: boolean;
  hasCadence: boolean;
  /** Power came from Strava's estimate, not a power meter. */
  estimatedPower: boolean;
  variabilityIndex: number | null;
  intensityFactor: number | null;
  tss: number | null;
  coastingPct: number | null;
  bands: RideGradeBand[];
};

export type RideContext = {
  sportType: string;
  movingTime: number;
  /** Strava's `average_watts`. */
  averageWatts: number | null;
  /** Strava's `weighted_average_watts`. */
  normalizedWatts: number | null;
  deviceWatts: boolean;
  ftp: number | null;
};

function finite(values: readonly number[] | null | undefined, index: number) {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasPositive(values: readonly number[] | null) {
  return Boolean(values?.some((value) => value > 0));
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function derivedGrade(input: RideStreams, index: number, length: number) {
  const low = Math.max(0, index - GRADE_HALF_WINDOW);
  const high = Math.min(length - 1, index + GRADE_HALF_WINDOW);
  const altLow = finite(input.altitude, low);
  const altHigh = finite(input.altitude, high);
  const distLow = finite(input.distance, low);
  const distHigh = finite(input.distance, high);
  if (altLow == null || altHigh == null || distLow == null || distHigh == null) return null;
  const run = distHigh - distLow;
  if (run < MIN_GRADE_DISTANCE_M) return null;
  return ((altHigh - altLow) / run) * 100;
}

class WeightedMean {
  private sum = 0;
  private weight = 0;

  add(value: number, weight: number) {
    this.sum += value * weight;
    this.weight += weight;
  }

  value(digits = 0) {
    return this.weight > 0 ? round(this.sum / this.weight, digits) : null;
  }
}

function emptyBucket() {
  return {
    durationSec: 0,
    distanceM: 0,
    hasDistance: false,
    coastingSec: 0,
    watts: new WeightedMean(),
    cadence: new WeightedMean(),
    speed: new WeightedMean(),
    heartrate: new WeightedMean(),
  };
}

export function buildRideAnalysis(input: RideStreams): RideAnalysis {
  const hasPower = hasPositive(input.watts);
  const hasCadence = hasPositive(input.cadence);
  const length = Math.max(
    input.time?.length ?? 0,
    input.watts?.length ?? 0,
    input.cadence?.length ?? 0,
    input.velocitySmooth?.length ?? 0,
  );
  const total = emptyBucket();
  const buckets = GRADE_BANDS.map(() => emptyBucket());

  for (let index = 0; index + 1 < length; index += 1) {
    const start = finite(input.time, index) ?? index;
    const end = finite(input.time, index + 1) ?? index + 1;
    const dt = Math.min(end - start, MAX_INTERVAL_SEC);
    if (!(dt > 0)) continue;

    const speedMs = finite(input.velocitySmooth, index);
    const moving = input.moving?.[index] ?? (speedMs == null || speedMs > STOPPED_SPEED_MS);
    if (!moving) continue;

    const grade =
      finite(input.gradeSmooth, index) ??
      (input.gradeSmooth?.length ? null : derivedGrade(input, index, length));
    const bandIndex = grade == null ? -1 : bandIndexForGrade(grade);
    const targets = bandIndex >= 0 ? [total, buckets[bandIndex]] : [total];

    const watts = hasPower ? finite(input.watts, index) : null;
    const cadence = hasCadence ? finite(input.cadence, index) : null;
    const hr = finite(input.heartrate, index);
    const distStart = finite(input.distance, index);
    const distEnd = finite(input.distance, index + 1);
    const coasting = hasCadence
      ? cadence != null && cadence <= 0
      : hasPower && watts != null && watts <= 0;

    for (const bucket of targets) {
      bucket.durationSec += dt;
      if (distStart != null && distEnd != null && distEnd >= distStart) {
        bucket.distanceM += distEnd - distStart;
        bucket.hasDistance = true;
      }
      if (coasting) bucket.coastingSec += dt;
      if (watts != null) bucket.watts.add(Math.max(0, watts), dt);
      if (cadence != null && cadence > 0) bucket.cadence.add(cadence, dt);
      if (speedMs != null) bucket.speed.add(speedMs * 3.6, dt);
      if (hr != null && hr > 0) bucket.heartrate.add(hr, dt);
    }
  }

  const tracksCoasting = hasCadence || hasPower;
  const bands = GRADE_BANDS.flatMap((band, index): RideGradeBand[] => {
    const bucket = buckets[index];
    if (bucket.durationSec < MIN_BAND_SEC) return [];
    return [
      {
        label: band.label,
        minGrade: band.min,
        maxGrade: band.max,
        durationSec: round(bucket.durationSec),
        distanceM: bucket.hasDistance ? round(bucket.distanceM) : null,
        avgWatts: bucket.watts.value(),
        avgCadence: bucket.cadence.value(),
        avgSpeedKmh: bucket.speed.value(1),
        avgHeartrate: bucket.heartrate.value(),
        coastingPct: tracksCoasting ? round((bucket.coastingSec / bucket.durationSec) * 100) : null,
      },
    ];
  });

  const normalized = hasPower ? normalizedPowerFromWatts(input.watts, input.time) : null;
  return {
    version: RIDE_ANALYSIS_VERSION,
    hasPower,
    hasCadence,
    movingSec: round(total.durationSec),
    avgWatts: total.watts.value(),
    normalizedWatts: normalized == null ? null : round(normalized),
    coastingSec: tracksCoasting ? round(total.coastingSec) : null,
    bands,
  };
}

export function isRideAnalysis(value: unknown): value is RideAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as RideAnalysis;
  return analysis.version === RIDE_ANALYSIS_VERSION && Array.isArray(analysis.bands);
}

/**
 * Adds the FTP-dependent numbers at read time, so changing FTP never needs a cache rebuild.
 * IF and TSS follow the training-load rules: power-meter rides only, never e-bikes.
 */
export function summarizeRide(analysis: RideAnalysis, context: RideContext): RideSummary | null {
  if (!analysis.hasPower && !analysis.hasCadence) return null;

  const normalized = analysis.hasPower
    ? (context.normalizedWatts ?? analysis.normalizedWatts)
    : null;
  const average = analysis.hasPower ? (context.averageWatts ?? analysis.avgWatts) : null;
  const variabilityIndex =
    normalized != null && average != null && average > 0 ? normalized / average : null;

  const scoresPower =
    analysis.hasPower && context.deviceWatts && isPowerCyclingSport(context.sportType);
  const intensityFactor =
    scoresPower && normalized != null && context.ftp != null && context.ftp > 0
      ? normalized / context.ftp
      : null;
  const tss =
    intensityFactor == null
      ? null
      : (Math.max(0, context.movingTime) / 3600) * intensityFactor * intensityFactor * 100;

  return {
    hasPower: analysis.hasPower,
    hasCadence: analysis.hasCadence,
    estimatedPower: analysis.hasPower && !context.deviceWatts,
    variabilityIndex,
    intensityFactor,
    tss,
    coastingPct:
      analysis.coastingSec != null && analysis.movingSec > 0
        ? (analysis.coastingSec / analysis.movingSec) * 100
        : null,
    bands: analysis.bands,
  };
}

/** Labels the value as shown (two decimals), so "1.05" never reads as "Mixed". */
export function variabilityLabel(index: number) {
  const shown = round(index, 2);
  if (shown <= 1.05) return "Steady";
  if (shown <= 1.15) return "Mixed";
  return "Surgy";
}
