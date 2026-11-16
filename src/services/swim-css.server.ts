import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams } from "@/db/schema.ts";
import { ensureBestEfforts } from "./best-efforts.server.ts";
import { SPORT_GROUPS } from "./sport-groups.ts";

const WINDOW_DAYS = 26 * 7;
const PLAUSIBLE_SEC_PER_100M = [55, 240] as const;

const SWIM_TYPES = [...SPORT_GROUPS.find((group) => group.id === "swimming")!.members];

function cssFrom(bests: Map<number, number>) {
  const t200 = bests.get(200);
  const t400 = bests.get(400);
  if (t200 && t400) {
    const css = (t400 - t200) / 2;
    if (css >= t200 / 2 && css <= t400 / 4 + 5) return css;
  }
  const long = [...bests]
    .filter(([metres]) => metres >= 1000)
    .map(([metres, seconds]) => seconds / (metres / 100));
  return long.length ? Math.min(...long) : null;
}

export async function swimCssFor(userId: string, now = new Date()): Promise<number | null> {
  const rows = await db
    .select({
      id: activities.id,
      sportType: activities.sportType,
      deviceWatts: activities.deviceWatts,
      streamId: activityStreams.activityId,
      bestEfforts: activityStreams.bestEfforts,
    })
    .from(activities)
    .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(
      and(
        eq(activities.userId, userId),
        inArray(activities.sportType, SWIM_TYPES),
        gte(activities.startDate, new Date(now.getTime() - WINDOW_DAYS * 86_400_000)),
      ),
    );
  const { bests } = await ensureBestEfforts(rows);
  const fastest = new Map<number, number>();
  for (const efforts of bests.values()) {
    for (const best of efforts.swim) {
      fastest.set(best.metres, Math.min(best.seconds, fastest.get(best.metres) ?? Infinity));
    }
  }
  const css = cssFrom(fastest);
  if (css == null) return null;
  const [low, high] = PLAUSIBLE_SEC_PER_100M;
  return css >= low && css <= high ? Math.round(css) : null;
}
