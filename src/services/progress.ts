import { createServerFn } from "@tanstack/react-start";

import type { PowerBest, RunBest } from "./best-efforts.ts";
import type { EfficiencyPoint } from "./heart-insights.ts";

/** Fitness settles over about six weeks, so "now" and "before" are six-week blocks. */
export const PROGRESS_WINDOW_DAYS = 42;
export const BEST_YEAR_DAYS = 365;
const MIN_WINDOW_SESSIONS = 3;
/** Efficiency moves a little week to week; smaller changes read as steady. */
const STEADY_PCT = 2;
const DAY_MS = 86_400_000;

/**
 * Rides with a power meter and flat runs are the only sessions whose output VO2 can compare
 * from one month to the next. Ride speed depends on wind and terrain, and swims, walks, and
 * other sports have no comparable output, so they are not shown here.
 */
export type ProgressSport = "cycling" | "running";

export type EfficiencyWindow = { output: number; count: number };

export type EfficiencyComparison = {
  /** A heart rate both blocks rode or ran near, so neither output is extrapolated far. */
  referenceBpm: number;
  now: EfficiencyWindow | null;
  before: EfficiencyWindow | null;
  changePct: number | null;
};

/** One duration (rides, seconds) or distance (runs, metres) and its best in each block. */
export type BestRow = {
  key: number;
  /** Watts for rides, seconds for runs. */
  now: number | null;
  before: number | null;
  year: number | null;
  yearStart: string | null;
};

export type SportProgress = {
  sport: ProgressSport;
  efficiency: EfficiencyComparison | null;
  bests: BestRow[];
};

export type ProgressData = {
  signedIn: boolean;
  sports: SportProgress[];
};

export type DatedBests<T> = { start: string; bests: T[] };

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function windowOf(start: string, now: Date) {
  const age = (now.getTime() - new Date(start).getTime()) / DAY_MS;
  if (age < 0) return null;
  if (age < PROGRESS_WINDOW_DAYS) return "now";
  if (age < PROGRESS_WINDOW_DAYS * 2) return "before";
  if (age < BEST_YEAR_DAYS) return "year";
  return null;
}

/**
 * Output at one heart rate in the last six weeks against the six weeks before, from the
 * median output per heartbeat of aerobic sessions in each block.
 */
export function compareEfficiency(
  points: EfficiencyPoint[],
  now = new Date(),
): EfficiencyComparison | null {
  const blocks = { now: [] as EfficiencyPoint[], before: [] as EfficiencyPoint[] };
  for (const point of points) {
    if (!point.aerobic) continue;
    const block = windowOf(point.start, now);
    if (block === "now" || block === "before") blocks[block].push(point);
  }
  const all = [...blocks.now, ...blocks.before];
  const middleBpm = median(all.map((point) => point.avgHeartrate));
  if (middleBpm == null || blocks.now.length < MIN_WINDOW_SESSIONS) return null;
  const referenceBpm = Math.round(middleBpm / 5) * 5;
  const summarize = (block: EfficiencyPoint[]): EfficiencyWindow | null => {
    if (block.length < MIN_WINDOW_SESSIONS) return null;
    const ef = median(block.map((point) => point.ef))!;
    return { output: Math.round(ef * referenceBpm * 10) / 10, count: block.length };
  };
  const current = summarize(blocks.now);
  const before = summarize(blocks.before);
  const changePct =
    current && before
      ? Math.round(((current.output - before.output) / before.output) * 1000) / 10
      : null;
  return { referenceBpm, now: current, before, changePct };
}

function compareBests<T>(
  activities: DatedBests<T>[],
  keys: readonly number[],
  keyOf: (best: T) => number,
  valueOf: (best: T) => number,
  better: (a: number, b: number) => boolean,
  now: Date,
): BestRow[] {
  const rows = keys.map((key): BestRow => ({
    key,
    now: null,
    before: null,
    year: null,
    yearStart: null,
  }));
  for (const activity of activities) {
    const block = windowOf(activity.start, now);
    if (!block) continue;
    for (const best of activity.bests) {
      const row = rows.find((item) => item.key === keyOf(best));
      if (!row) continue;
      const value = valueOf(best);
      if (block !== "year" && (row[block] == null || better(value, row[block]))) {
        row[block] = value;
      }
      if (row.year == null || better(value, row.year)) {
        row.year = value;
        row.yearStart = activity.start;
      }
    }
  }
  return rows.filter((row) => row.year != null);
}

export function comparePowerBests(
  activities: DatedBests<PowerBest>[],
  durations: readonly number[],
  now = new Date(),
) {
  return compareBests(
    activities,
    durations,
    (best) => best.seconds,
    (best) => best.watts,
    (a, b) => a > b,
    now,
  );
}

export function compareRunBests(
  activities: DatedBests<RunBest>[],
  distances: readonly number[],
  now = new Date(),
) {
  return compareBests(
    activities,
    distances,
    (best) => best.metres,
    (best) => best.seconds,
    (a, b) => a < b,
    now,
  );
}

/** Positive when the last six weeks beat the six before: more watts, or less time. */
export function bestChangePct(row: BestRow, sport: ProgressSport) {
  if (row.now == null || row.before == null) return null;
  const change = sport === "cycling" ? row.now / row.before - 1 : row.before / row.now - 1;
  return Math.round(change * 1000) / 10;
}

export function efficiencyVerdict(comparison: EfficiencyComparison) {
  const change = comparison.changePct;
  if (change == null) return null;
  if (change >= STEADY_PCT) {
    return {
      tone: "positive" as const,
      text: "More output for the same heart rate: your aerobic engine is growing.",
    };
  }
  if (change <= -STEADY_PCT) {
    return {
      tone: "warning" as const,
      text: "Less output for the same heart rate. Heat, fatigue, or a lighter block can explain it; if it lasts, add easy volume or rest.",
    };
  }
  return {
    tone: "neutral" as const,
    text: "About the same output for the same heart rate.",
  };
}

export const loadProgress = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProgressData> => {
    const { loadProgressImpl } = await import("./progress.server.ts");
    return loadProgressImpl();
  },
);
