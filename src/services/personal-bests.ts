import { createServerFn } from "@tanstack/react-start";

import type { BestsPeriod, BestsSport } from "./bests-search.ts";

export {
  BESTS_SPORTS,
  type BestsPeriod,
  type BestsReturn,
  type BestsSearch,
  type BestsSport,
} from "./bests-search.ts";

export type BoardKind = "time" | "power" | "longest" | "climbing" | "climb";

export type BestsActivity = { id: string; name: string; start: string; sportType: string };

export type Effort = {
  activity: number;
  value: number;
  distanceM?: number | null;
  gradePct?: number | null;
};

export type Board = {
  id: string;
  sport: BestsSport;
  kind: BoardKind;
  key: number;
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
  bestSoFar: number;
  isBest: boolean;
};

const NEW_BEST_DAYS = 30;
export const TOP_EFFORTS = 10;
const DAY_MS = 86_400_000;

export function boardId(sport: BestsSport, kind: BoardKind, key = 0) {
  return `${sport}-${kind}-${key}`;
}

export function lowerIsBetter(kind: BoardKind) {
  return kind === "time";
}

function beats(kind: BoardKind, a: number, b: number) {
  return lowerIsBetter(kind) ? a < b : a > b;
}

function inPeriod(start: string, period: BestsPeriod, now = new Date()) {
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

export function previousBest(points: ProgressionPoint[]) {
  const steps = points.filter((point) => point.isBest);
  return steps.length >= 2 ? steps[steps.length - 2] : null;
}

export function isNewBest(start: string, now = new Date()) {
  return now.getTime() - new Date(start).getTime() < NEW_BEST_DAYS * DAY_MS;
}

export function periodYears(activities: BestsActivity[]) {
  const years = new Set(activities.map((activity) => new Date(activity.start).getFullYear()));
  return [...years].sort((a, b) => b - a).map((year) => String(year) as `${number}`);
}

export type PowerCurvePoint = { seconds: number; period: number | null; allTime: number | null };

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
