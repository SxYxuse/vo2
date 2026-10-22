/** Bump when the stored shape or the math changes, so cached rows are rebuilt on next load. */
export const BEST_EFFORTS_VERSION = 1;

/** Ride durations (seconds) a best average power is kept for. */
export const POWER_DURATIONS = [60, 300, 1200, 3600] as const;
/** Run distances (metres) a best time is kept for. */
export const RUN_DISTANCES = [1000, 5000, 10000, 21097.5] as const;

/** Longest gap one power sample may stand for; a longer gap is a stop and counts as zero. */
const MAX_INTERVAL_SEC = 10;
/**
 * A run gap slower than this was a pause, not sparse recording ("smart" recording can leave
 * several seconds between samples), so it stops the clock and a red light never costs a record.
 */
const PAUSED_SPEED_MS = 0.5;

export type PowerBest = { seconds: number; watts: number };
export type RunBest = { metres: number; seconds: number };

/** Per-activity bests, cached on `activity_streams.best_efforts`. */
export type BestEfforts = {
  version: typeof BEST_EFFORTS_VERSION;
  power: PowerBest[];
  run: RunBest[];
};

export function isBestEfforts(value: unknown): value is BestEfforts {
  if (!value || typeof value !== "object") return false;
  const bests = value as BestEfforts;
  return (
    bests.version === BEST_EFFORTS_VERSION && Array.isArray(bests.power) && Array.isArray(bests.run)
  );
}

/**
 * Highest average power over each duration. The ride is laid on a one-second grid so uneven
 * recording intervals weigh by time; a gap longer than a few seconds is a stop and counts as
 * zero, like a mean-max power curve.
 */
export function powerBests(
  watts: number[] | null,
  time: number[] | null,
  durations: readonly number[] = POWER_DURATIONS,
): PowerBest[] {
  if (!watts?.length || !time || time.length !== watts.length) return [];
  const grid: number[] = [];
  for (let index = 0; index < watts.length; index += 1) {
    const value = Math.max(0, Number.isFinite(watts[index]) ? watts[index] : 0);
    const next = time[index + 1];
    const delta = next == null ? 1 : Math.round(next - time[index]);
    if (delta <= 0) continue;
    const held = Math.min(delta, MAX_INTERVAL_SEC);
    for (let second = 0; second < delta; second += 1) grid.push(second < held ? value : 0);
  }

  const results: PowerBest[] = [];
  for (const seconds of durations) {
    if (grid.length < seconds) break;
    let sum = 0;
    for (let index = 0; index < seconds; index += 1) sum += grid[index];
    let best = sum;
    for (let index = seconds; index < grid.length; index += 1) {
      sum += grid[index] - grid[index - seconds];
      if (sum > best) best = sum;
    }
    const average = Math.round(best / seconds);
    if (average > 0) results.push({ seconds, watts: average });
  }
  return results;
}

/**
 * Fastest time over each distance, from the distance and time streams. The window's time is
 * scaled to the exact distance; paused time is left out.
 */
export function runBests(
  distance: number[] | null,
  time: number[] | null,
  distances: readonly number[] = RUN_DISTANCES,
): RunBest[] {
  if (!distance?.length || !time || time.length !== distance.length) return [];
  const clock: number[] = [0];
  for (let index = 1; index < time.length; index += 1) {
    const delta = time[index] - time[index - 1];
    const paused =
      delta > MAX_INTERVAL_SEC && (distance[index] - distance[index - 1]) / delta < PAUSED_SPEED_MS;
    clock.push(clock[index - 1] + (delta > 0 && !paused ? delta : 0));
  }

  const results: RunBest[] = [];
  for (const metres of distances) {
    if ((distance.at(-1) ?? 0) - distance[0] < metres) break;
    let best = Infinity;
    let from = 0;
    for (let to = 1; to < distance.length; to += 1) {
      while (from + 1 < to && distance[to] - distance[from + 1] >= metres) from += 1;
      const covered = distance[to] - distance[from];
      if (covered < metres) continue;
      const elapsed = ((clock[to] - clock[from]) * metres) / covered;
      if (elapsed > 0 && elapsed < best) best = elapsed;
    }
    if (Number.isFinite(best)) results.push({ metres, seconds: Math.round(best) });
  }
  return results;
}

export function buildBestEfforts(streams: {
  watts: number[] | null;
  distance: number[] | null;
  time: number[] | null;
  power: boolean;
  run: boolean;
}): BestEfforts {
  return {
    version: BEST_EFFORTS_VERSION,
    power: streams.power ? powerBests(streams.watts, streams.time) : [],
    run: streams.run ? runBests(streams.distance, streams.time) : [],
  };
}
