import { peakSustainedHeartrates } from "./heart-insights.ts";
import { estimateLthrFromMax, lthrShareOfMax, type ZonedFamily } from "./heart-rate.ts";

/** Threshold moves with fitness within weeks, so only recent efforts count (max HR keeps 18 months). */
export const LTHR_WINDOW_DAYS = 180;
/** The shortest window that says anything about threshold. */
export const LTHR_MIN_SECONDS = 20 * 60;
const HOUR_SECONDS = 60 * 60;
/** Friel's 20-minute test: LTHR is about 95 % of the average heart rate held for 20 minutes. */
const TWENTY_MIN_SHARE = 0.95;
/** Real LTHR sits within about ±4 % of max around the usual share; a hard effort lands inside this. */
const BAND_OF_MAX = 0.05;
/** One effort could be a cadence lock or a hot day; two agree on something. */
const MIN_EFFORTS = 2;
const TOP_EFFORTS = 3;

/**
 * The threshold one activity implies: the best hour's average heart rate, or 95 % of the best
 * 20 minutes, whichever is higher. Samples above max HR are dropped as spikes, and the rolling
 * average keeps a few high seconds from reading as an effort.
 */
export function thresholdEffort(
  heartrate: number[] | null | undefined,
  time: number[] | null | undefined,
  maxHr: number,
): number | null {
  if (!heartrate?.length) return null;
  const cleaned = heartrate.map((bpm) => (bpm > maxHr ? Number.NaN : bpm));
  const peaks = peakSustainedHeartrates(cleaned, time ?? null, [LTHR_MIN_SECONDS, HOUR_SECONDS]);
  const twenty = peaks.find((peak) => peak.seconds === LTHR_MIN_SECONDS)?.bpm;
  const hour = peaks.find((peak) => peak.seconds === HOUR_SECONDS)?.bpm ?? 0;
  if (twenty == null) return null;
  return Math.max(hour, twenty * TWENTY_MIN_SHARE);
}

/**
 * LTHR from the athlete's hardest recent efforts: the median of the best three, once at least
 * two land within 5 % of max of the usual share. Easier sessions sit below that band and never
 * count, so long easy days can't drag the estimate down; an estimate above the band is capped.
 * Without enough hard efforts, LTHR stays the usual share of max.
 */
export function estimateLthr(
  efforts: number[],
  maxHr: number | null,
  family: ZonedFamily,
): number | null {
  const fallback = estimateLthrFromMax(maxHr, family);
  if (fallback == null || maxHr == null) return fallback;
  const share = lthrShareOfMax(family);
  const floor = maxHr * (share - BAND_OF_MAX);
  const ceiling = maxHr * (share + BAND_OF_MAX);
  const hard = efforts.filter((bpm) => bpm >= floor).sort((a, b) => b - a);
  if (hard.length < MIN_EFFORTS) return fallback;
  const top = hard.slice(0, TOP_EFFORTS);
  const middle = top.length % 2 ? top[(top.length - 1) / 2] : (top[0] + top[1]) / 2;
  return Math.round(Math.min(middle, ceiling));
}
