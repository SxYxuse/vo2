import { createServerFn } from "@tanstack/react-start";

// Apart so route search parsing, which ships with the app's entry, loads none of the rest.
import type { BestsPeriod, BestsSport } from "./bests-search.ts";

export {
  BESTS_SPORTS,
  parseBestsReturn,
  parseBestsSearch,
  type BestsPeriod,
  type BestsReturn,
  type BestsSearch,
  type BestsSport,
} from "./bests-search.ts";

/**
 * What a board ranks: the fastest time over a distance, the best average power over a
 * duration, or one activity's biggest day (longest, most climbing, biggest single climb).
 */
export type BoardKind = "time" | "power" | "longest" | "climbing" | "climb";

export type BestsActivity = { id: string; name: string; start: string; sportType: string };

/** One activity's value on a board: seconds, watts, or metres. */
export type Effort = {
  /** Index into `BestsData.activities`, so the payload names each activity once. */
  activity: number;
  value: number;
  /** A climb's length and average gradient. */
  distanceM?: number | null;
  gradePct?: number | null;
};

export type Board = {
  id: string;
  sport: BestsSport;
  kind: BoardKind;
  /** Metres for a time board, seconds for a power board, 0 for a biggest-day board. */
  key: number;
  /** Every activity's best on this board, at most one per activity. */
  efforts: Effort[];
};

export type BestsData = {
  signedIn: boolean;
  weightKg: number | null;
  activities: BestsActivity[];
  boards: Board[];
};

export type RankedEffort = Omit<Effort, "activity"> & { rank: number; activity: BestsActivity };

export type ProgressionPoint = {
  start: string;
  value: number;
  activityId: string;
  /** The best so far up to and including this effort. */
  bestSoFar: number;
  /** This effort set a new best within the period. */
  isBest: boolean;
};

/** A best set this recently gets a "New" badge. */
export const NEW_BEST_DAYS = 30;
export const TOP_EFFORTS = 10;
const DAY_MS = 86_400_000;

export function boardId(sport: BestsSport, kind: BoardKind, key = 0) {
  return `${sport}-${kind}-${key}`;
}

/** Times are better lower; power, distance, and climbing are better higher. */
export function lowerIsBetter(kind: BoardKind) {
  return kind === "time";
}

function beats(kind: BoardKind, a: number, b: number) {
  return lowerIsBetter(kind) ? a < b : a > b;
}

export function inPeriod(start: string, period: BestsPeriod, now = new Date()) {
  const at = new Date(start);
  if (period === "all") return true;
  if (period === "12m") return now.getTime() - at.getTime() < 365 * DAY_MS;
  if (period === "6w") return now.getTime() - at.getTime() < 42 * DAY_MS;
  return String(at.getFullYear()) === period;
}

function periodEfforts(board: Board, activities: BestsActivity[], period: BestsPeriod, now: Date) {
  return board.efforts.flatMap((effort) => {
    const activity = activities[effort.activity];
    return activity && inPeriod(activity.start, period, now) ? [{ ...effort, activity }] : [];
  });
}

/** The best efforts on a board within the period, best first; the first is the personal best. */
export function topEfforts(
  board: Board,
  activities: BestsActivity[],
  period: BestsPeriod,
  now = new Date(),
  limit = TOP_EFFORTS,
): RankedEffort[] {
  return periodEfforts(board, activities, period, now)
    .sort((a, b) =>
      a.value === b.value
        ? a.activity.start.localeCompare(b.activity.start)
        : beats(board.kind, a.value, b.value)
          ? -1
          : 1,
    )
    .slice(0, limit)
    .map((effort, index) => ({ ...effort, rank: index + 1 }));
}

/** Every effort in date order, with the best so far, so each new best shows as a step. */
export function progression(
  board: Board,
  activities: BestsActivity[],
  period: BestsPeriod,
  now = new Date(),
): ProgressionPoint[] {
  let best: number | null = null;
  return periodEfforts(board, activities, period, now)
    .sort((a, b) => a.activity.start.localeCompare(b.activity.start))
    .map((effort) => {
      const isBest = best == null || beats(board.kind, effort.value, best);
      if (isBest) best = effort.value;
      return {
        start: effort.activity.start,
        value: effort.value,
        activityId: effort.activity.id,
        bestSoFar: best!,
        isBest,
      };
    });
}

/** The best the personal best beat, for "0:19 faster than your previous best". */
export function previousBest(points: ProgressionPoint[]) {
  const steps = points.filter((point) => point.isBest);
  return steps.length >= 2 ? steps[steps.length - 2] : null;
}

export function isNewBest(start: string, now = new Date()) {
  return now.getTime() - new Date(start).getTime() < NEW_BEST_DAYS * DAY_MS;
}

/** Calendar years with at least one activity, newest first, for the period picker. */
export function periodYears(activities: BestsActivity[]) {
  const years = new Set(activities.map((activity) => new Date(activity.start).getFullYear()));
  return [...years].sort((a, b) => b - a).map((year) => String(year) as `${number}`);
}

export type PowerCurvePoint = { seconds: number; period: number | null; allTime: number | null };

/** Best power at each duration within the period, against the best of all time. */
export function powerCurve(
  boards: Board[],
  activities: BestsActivity[],
  period: BestsPeriod,
  now = new Date(),
): PowerCurvePoint[] {
  return boards
    .filter((board) => board.kind === "power")
    .sort((a, b) => a.key - b.key)
    .flatMap((board) => {
      const allTime = topEfforts(board, activities, "all", now, 1)[0]?.value ?? null;
      if (allTime == null) return [];
      const inside = topEfforts(board, activities, period, now, 1)[0]?.value ?? null;
      return [{ seconds: board.key, period: inside, allTime }];
    });
}

export const loadBests = createServerFn({ method: "GET" }).handler(async (): Promise<BestsData> => {
  const { loadBestsImpl } = await import("./personal-bests.server.ts");
  return loadBestsImpl();
});
