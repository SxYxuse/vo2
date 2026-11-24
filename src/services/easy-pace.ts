import { isPlausibleBpm } from "./bpm.ts";
import type { PaceRange } from "./training-paces.types.ts";

const FLAT_PACES_VERSION = 1;

export type FlatPaces = { version: number; cells: [number, number, number][] };

export function isFlatPaces(value: unknown): value is FlatPaces {
  return (
    typeof value === "object" &&
    value != null &&
    (value as FlatPaces).version === FLAT_PACES_VERSION &&
    Array.isArray((value as FlatPaces).cells)
  );
}

const FLAT_GRADE_PCT = 2;
const WARM_UP_SEC = 5 * 60;
const MAX_GAP_SEC = 30;
const MIN_SPEED_MS = 1.5;
const PACE_STEP_SEC = 2;

type FlatStreams = {
  time: number[] | null;
  heartrate: number[] | null;
  velocitySmooth: number[] | null;
  gradeSmooth: number[] | null;
  moving: boolean[] | null;
};

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

export const ZONE_2_MIN_SEC = 60 * 60;
const BAND: [number, number] = [0.25, 0.75];

export type Zone2Pace = {
  minBpm: number;
  maxBpm: number;
  minutes: number;
  range: PaceRange | null;
};

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
