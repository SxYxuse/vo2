import { isPlausibleBpm } from "./heart-rate.ts";
import type { PaceRange } from "./training-paces.types.ts";

/**
 * The easy pace from zone 2 heart rate (ADR 0042): the pace the athlete holds in running zone 2
 * on flat stretches of recent road runs. Each run's flat running is cached as seconds per heart
 * rate and pace, so changing zones or the window reads the cache rather than every stream.
 */

/** Bump when the cached shape or the sample rules change, so rows are rebuilt on next read. */
const FLAT_PACES_VERSION = 1;

/** Flat running of one run: [bpm, seconds per km, seconds] cells. */
export type FlatPaces = { version: number; cells: [number, number, number][] };

export function isFlatPaces(value: unknown): value is FlatPaces {
  return (
    typeof value === "object" &&
    value != null &&
    (value as FlatPaces).version === FLAT_PACES_VERSION &&
    Array.isArray((value as FlatPaces).cells)
  );
}

/** Strava's smoothed grade within this, either way, is flat: hills move pace more than fitness. */
const FLAT_GRADE_PCT = 2;
/** Heart rate lags and climbs in the first minutes, so a run's zone 2 counts after this. */
const WARM_UP_SEC = 5 * 60;
/** A longer gap between samples is a pause, not running. */
const MAX_GAP_SEC = 30;
/** Slower than this is a walk break, not an easy pace (about 11:00 /km). */
const MIN_SPEED_MS = 1.5;
/** Paces are kept to this many seconds per km, enough for a range shown to the second. */
const PACE_STEP_SEC = 2;

type FlatStreams = {
  time: number[] | null;
  heartrate: number[] | null;
  velocitySmooth: number[] | null;
  gradeSmooth: number[] | null;
  moving: boolean[] | null;
};

/** One run's flat running after the warm-up, by heart rate and pace. */
export function buildFlatPaces(streams: FlatStreams): FlatPaces {
  const { time, heartrate, velocitySmooth: speed, gradeSmooth: grade, moving } = streams;
  const cells = new Map<string, [number, number, number]>();
  if (time && heartrate && speed && grade) {
    let movingSec = 0;
    for (let i = 1; i < time.length; i += 1) {
      const dt = time[i]! - time[i - 1]!;
      if (dt <= 0 || dt > MAX_GAP_SEC || moving?.[i] === false) continue;
      movingSec += dt;
      const bpm = Math.round(heartrate[i] ?? 0);
      const metresPerSec = speed[i] ?? 0;
      if (
        movingSec <= WARM_UP_SEC ||
        !isPlausibleBpm(bpm) ||
        metresPerSec < MIN_SPEED_MS ||
        Math.abs(grade[i] ?? Infinity) > FLAT_GRADE_PCT
      ) {
        continue;
      }
      const pace = Math.round(1000 / metresPerSec / PACE_STEP_SEC) * PACE_STEP_SEC;
      const key = `${bpm}:${pace}`;
      const cell = cells.get(key) ?? [bpm, pace, 0];
      cell[2] += dt;
      cells.set(key, cell);
    }
  }
  return { version: FLAT_PACES_VERSION, cells: [...cells.values()] };
}

/** About an hour of flat zone 2 running gives a pace that one odd day doesn't move. */
export const ZONE_2_MIN_SEC = 60 * 60;
/** Easy pace runs from the 25th to the 75th percentile of that time, fastest to slowest. */
const BAND: [number, number] = [0.25, 0.75];

export type Zone2Pace = {
  minBpm: number;
  maxBpm: number;
  /** Flat zone 2 running found in the window, rounded to the minute. */
  minutes: number;
  /** Null below ZONE_2_MIN_SEC: easy pace then comes from the VDOT. */
  range: PaceRange | null;
};

/**
 * The middle half of the time spent in zone 2 on the flat, by pace: the range most of that
 * running sits in, without the odd fast stride or slow stretch into the wind.
 */
export function zone2Pace(runs: FlatPaces[], zone: { minBpm: number; maxBpm: number }): Zone2Pace {
  const paces = runs
    .flatMap((run) => run.cells)
    .filter(([bpm]) => bpm >= zone.minBpm && bpm <= zone.maxBpm)
    .sort((a, b) => a[1] - b[1]);
  const total = paces.reduce((sum, cell) => sum + cell[2], 0);
  const at = (share: number) => {
    let seen = 0;
    for (const [, pace, seconds] of paces) {
      seen += seconds;
      if (seen >= total * share) return pace;
    }
    return paces.at(-1)?.[1] ?? 0;
  };
  return {
    ...zone,
    minutes: Math.round(total / 60),
    range:
      total >= ZONE_2_MIN_SEC ? { fastSecPerKm: at(BAND[0]), slowSecPerKm: at(BAND[1]) } : null,
  };
}
