import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  TOP_EFFORTS,
  topEfforts,
  type BestsActivity,
  type BestsSport,
  type Board,
  type BoardKind,
} from "./personal-bests.ts";

export const CELEBRATE_WITHIN_DAYS = 7;

export type TopEffortPlacement = {
  boardId: string;
  sport: BestsSport;
  kind: BoardKind;
  key: number;
  value: number;
  distanceM?: number | null;
  gradePct?: number | null;
  allTimeRank: number | null;
  yearRank: number | null;
  year: number;
  activity: BestsActivity;
};

export function findTopEfforts(
  boards: Board[],
  activities: BestsActivity[],
  activityIds: ReadonlySet<string>,
  now = new Date(),
): TopEffortPlacement[] {
  const placements: TopEffortPlacement[] = [];
  for (const board of boards) {
    const allTime = topEfforts(board, activities, "all", now);
    for (const effort of board.efforts) {
      const activity = activities[effort.activity];
      if (!activity || !activityIds.has(activity.id)) continue;
      const year = new Date(activity.start).getFullYear();
      const earlierThisYear = board.efforts.filter((other) => {
        const at = activities[other.activity]?.start;
        return at != null && at < activity.start && new Date(at).getFullYear() === year;
      }).length;
      const yearTop =
        earlierThisYear >= TOP_EFFORTS
          ? topEfforts(board, activities, `${year}` as `${number}`, now)
          : [];
      const allTimeRank = rankOf(allTime, activity.id);
      const yearRank = rankOf(yearTop, activity.id);
      if (allTimeRank == null && yearRank == null) continue;
      placements.push({
        boardId: board.id,
        sport: board.sport,
        kind: board.kind,
        key: board.key,
        value: effort.value,
        ...(effort.distanceM !== undefined ? { distanceM: effort.distanceM } : {}),
        ...(effort.gradePct !== undefined ? { gradePct: effort.gradePct } : {}),
        allTimeRank,
        yearRank,
        year,
        activity,
      });
    }
  }
  return placements.sort(byBestPlacement);
}

export function byBestPlacement(a: TopEffortPlacement, b: TopEffortPlacement) {
  const rank = (value: number | null) => value ?? TOP_EFFORTS + 1;
  return rank(a.allTimeRank) - rank(b.allTimeRank) || rank(a.yearRank) - rank(b.yearRank);
}

function rankOf(ranked: { rank: number; activity: BestsActivity }[], activityId: string) {
  return ranked.find((effort) => effort.activity.id === activityId)?.rank ?? null;
}

export type CelebratedActivity = {
  distance: number | null;
  movingTime: number;
  totalElevationGain: number | null;
  averageHeartrate: number | null;
  averageWatts: number | null;
};

export type TopEffortCelebrations = {
  activityIds: string[];
  placements: TopEffortPlacement[];
  activities: Record<string, CelebratedActivity>;
};

export const loadTopEffortCelebrations = createServerFn({ method: "GET" }).handler(
  async (): Promise<TopEffortCelebrations> => {
    const { loadTopEffortCelebrationsImpl } = await import("./top-efforts.server.ts");
    return loadTopEffortCelebrationsImpl();
  },
);

export const markTopEffortsSeen = createServerFn({ method: "POST" })
  .validator(z.object({ activityIds: z.array(z.string()).max(500) }))
  .handler(async ({ data }): Promise<void> => {
    const { markTopEffortsSeenImpl } = await import("./top-efforts.server.ts");
    await markTopEffortsSeenImpl(data.activityIds);
  });
