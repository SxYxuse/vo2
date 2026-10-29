import { allElevationClimbs, buildActivitySamples } from "./activity-analysis.types.ts";
import { isPowerCyclingSport } from "./training-load.ts";

/** Bump when the stored shape or the math changes, so cached rows are rebuilt on next load. */
export const BEST_EFFORTS_VERSION = 2;

const MILE = 1609.344;

/** Ride durations (seconds) a best average power is kept for: enough points to draw a curve. */
export const POWER_DURATIONS = [
  5, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 2700, 3600, 5400, 7200, 10800,
] as const;
/** Run distances (metres) a best time is kept for. */
export const RUN_DISTANCES = [
  400,
  1000,
  MILE,
  2 * MILE,
  5000,
  5 * MILE,
  10000,
  10 * MILE,
  21097.5,
  42195,
] as const;
/** Outdoor ride distances (metres) a best time is kept for. */
export const RIDE_DISTANCES = [10000, 20000, 50000, 100000, 150000, 200000] as const;
/** Swim distances (metres) a best time is kept for, up to the Ironman swim. */
export const SWIM_DISTANCES = [100, 200, 400, 750, 1000, 1500, 1900, 3800] as const;

/** Longest gap one power sample may stand for; a longer gap is a stop and counts as zero. */
const MAX_INTERVAL_SEC = 10;
/**
 * A run gap slower than this was a pause, not sparse recording ("smart" recording can leave
 * several seconds between samples), so it stops the clock and a red light never costs a record.
 */
const PAUSED_SPEED_MS = 0.5;

/** No sensor glitch survives this: no rider holds 2,500 W, even for five seconds. */
const MAX_WATTS = 2500;
/** A ride faster than this over 10 km or more is a GPS jump or a car, not a ride. */
const MAX_RIDE_SPEED_MS = 80 / 3.6;
/**
 * Seconds a little under the world record for each distance: anything faster is a GPS jump.
 * Swims use short-course records, which are the faster ones.
 */
const RUN_FLOOR_SEC: Record<number, number> = {
  400: 43,
  1000: 131,
  [MILE]: 220,
  [2 * MILE]: 470,
  5000: 755,
  [5 * MILE]: 1200,
  10000: 1571,
  [10 * MILE]: 2600,
  21097.5: 3400,
  42195: 7200,
};
const SWIM_FLOOR_SEC: Record<number, number> = {
  100: 44,
  200: 98,
  400: 212,
  750: 400,
  1000: 520,
  1500: 840,
  1900: 1080,
  3800: 2200,
};

/** Ride types whose speed and climbing are real: no motor and no simulator. */
const OUTDOOR_RIDE_SPORTS = new Set(["Ride", "GravelRide", "MountainBikeRide"]);
const SWIM_SPORTS = new Set(["Swim", "OpenWaterSwim"]);
const CLIMB_SPORTS = new Set([...OUTDOOR_RIDE_SPORTS, "Run", "TrailRun"]);

export type PowerBest = { seconds: number; watts: number };
export type DistanceBest = { metres: number; seconds: number };
export type ClimbBest = { gainM: number; distanceM: number | null; avgGradePct: number | null };

/** Per-activity bests, cached on `activity_streams.best_efforts`. */
export type BestEfforts = {
  version: typeof BEST_EFFORTS_VERSION;
  power: PowerBest[];
  run: DistanceBest[];
  ride: DistanceBest[];
  swim: DistanceBest[];
  /** The single biggest climb, found the same way as in activity analysis. */
  climb: ClimbBest | null;
};

export type DistanceSport = "run" | "ride" | "swim";

export function isBestEfforts(value: unknown): value is BestEfforts {
  if (!value || typeof value !== "object") return false;
  const bests = value as BestEfforts;
  return (
    bests.version === BEST_EFFORTS_VERSION &&
    Array.isArray(bests.power) &&
    Array.isArray(bests.run) &&
    Array.isArray(bests.ride) &&
    Array.isArray(bests.swim)
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
    const raw = Number.isFinite(watts[index]) ? watts[index] : 0;
    // A sample no rider can produce is a sensor spike; it would lift every longer average.
    const value = raw > MAX_WATTS ? 0 : Math.max(0, raw);
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

function fastestPossible(metres: number, sport: DistanceSport) {
  if (sport === "run") return RUN_FLOOR_SEC[metres] ?? 0;
  if (sport === "swim") return SWIM_FLOOR_SEC[metres] ?? 0;
  return metres / MAX_RIDE_SPEED_MS;
}

/** Seconds on the move at each sample: a long, slow gap on a ride or run stops the clock. */
export function movingClock(distance: number[], time: number[], sport: DistanceSport) {
  const clock: number[] = [0];
  for (let index = 1; index < time.length; index += 1) {
    const delta = time[index] - time[index - 1];
    const paused =
      sport !== "swim" &&
      delta > MAX_INTERVAL_SEC &&
      (distance[index] - distance[index - 1]) / delta < PAUSED_SPEED_MS;
    clock.push(clock[index - 1] + (delta > 0 && !paused ? delta : 0));
  }
  return clock;
}

/**
 * Fastest time over each distance, from the distance and time streams. The window's time is
 * scaled to the exact distance. On runs and rides paused time is left out; in a swim, rest at
 * the wall keeps the clock running, or a 1500 m best could be stitched from 100 m repeats.
 * A time faster than humanly possible is a GPS jump and is dropped.
 */
export function distanceBests(
  distance: number[] | null,
  time: number[] | null,
  distances: readonly number[],
  sport: DistanceSport,
): DistanceBest[] {
  if (!distance?.length || !time || time.length !== distance.length) return [];
  const clock = movingClock(distance, time, sport);

  const results: DistanceBest[] = [];
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
    if (Number.isFinite(best) && best >= fastestPossible(metres, sport)) {
      results.push({ metres, seconds: Math.round(best) });
    }
  }
  return results;
}

function biggestClimb(
  streams: { time: number[] | null; distance: number[] | null; altitude: number[] | null },
  sportType: string,
): ClimbBest | null {
  if (!streams.altitude?.length) return null;
  const samples = buildActivitySamples({
    time: streams.time,
    distance: streams.distance,
    altitude: streams.altitude,
    gradeSmooth: null,
    heartrate: null,
    watts: null,
    velocitySmooth: null,
    cadence: null,
  });
  let top: ClimbBest | null = null;
  for (const climb of allElevationClimbs(samples, sportType)) {
    if (top && climb.elevationDeltaM <= top.gainM) continue;
    top = {
      gainM: Math.round(climb.elevationDeltaM),
      distanceM: climb.distanceM == null ? null : Math.round(climb.distanceM),
      avgGradePct: climb.avgGradePct,
    };
  }
  return top;
}

/**
 * Every best one activity can hold. Each list is filled only for the sport types it is fair
 * on: power on any power-meter ride, road-run pace on Run, ride speed on outdoor rides without
 * a motor, and swim pace on swims. Climbs come from outdoor rides and runs, trail runs included.
 */
export function buildBestEfforts(input: {
  sportType: string;
  deviceWatts: boolean;
  watts: number[] | null;
  distance: number[] | null;
  time: number[] | null;
  altitude: number[] | null;
}): BestEfforts {
  const { sportType } = input;
  return {
    version: BEST_EFFORTS_VERSION,
    power:
      isPowerCyclingSport(sportType) && input.deviceWatts
        ? powerBests(input.watts, input.time)
        : [],
    run: sportType === "Run" ? distanceBests(input.distance, input.time, RUN_DISTANCES, "run") : [],
    ride: OUTDOOR_RIDE_SPORTS.has(sportType)
      ? distanceBests(input.distance, input.time, RIDE_DISTANCES, "ride")
      : [],
    swim: SWIM_SPORTS.has(sportType)
      ? distanceBests(input.distance, input.time, SWIM_DISTANCES, "swim")
      : [],
    climb: CLIMB_SPORTS.has(sportType) ? biggestClimb(input, sportType) : null,
  };
}

/** Sport types each tab of the bests page reads, before hidden sport types are dropped. */
export function isOutdoorRideSport(sportType: string) {
  return OUTDOOR_RIDE_SPORTS.has(sportType);
}

export function isSwimSport(sportType: string) {
  return SWIM_SPORTS.has(sportType);
}

/** Whether VO2 has any best to build from this activity's streams. */
export function hasBestEfforts(row: { sportType: string; deviceWatts: boolean }) {
  return (
    (isPowerCyclingSport(row.sportType) && row.deviceWatts) ||
    CLIMB_SPORTS.has(row.sportType) ||
    SWIM_SPORTS.has(row.sportType)
  );
}
