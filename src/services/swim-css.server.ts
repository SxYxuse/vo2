import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams } from "@/db/schema.ts";
import { ensureBestEfforts } from "./best-efforts.server.ts";
import { SPORT_GROUPS } from "./sport-groups.ts";

/*
 * The athlete's CSS, critical swim speed, in seconds per 100 m: the pace swim zones are set from
 * (ADR 0061). VO2 has no swim test (ADR 0011), so it reads the swims' best efforts, rest at the
 * wall included, from the last six months.
 */

const WINDOW_DAYS = 26 * 7;
/** Anything outside this is a recording glitch, not a swimmer's threshold pace. */
const PLAUSIBLE_SEC_PER_100M = [55, 240] as const;

const SWIM_TYPES = [...SPORT_GROUPS.find((group) => group.id === "swimming")!.members];

/**
 * CSS from the fastest 200 m and 400 m: (t400 − t200) / 2, the classic two-distance estimate. When
 * the two come from swims too far apart to fit (a fresh 200 m, a tired 400 m), or one is missing,
 * the best pace over 1,000 m or more stands in: a long continuous swim sits at or a little slower
 * than CSS, so the zones err easy. Null without either.
 */
function cssFrom(bests: Map<number, number>) {
  const t200 = bests.get(200);
  const t400 = bests.get(400);
  if (t200 && t400) {
    const css = (t400 - t200) / 2;
    // CSS sits between the 200's pace and a little past the 400's.
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
