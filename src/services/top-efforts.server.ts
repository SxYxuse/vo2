import { and, eq, gte, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, topEffortCelebrations } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { BESTS_SPORT_TYPES, loadBestsForUser } from "./personal-bests.server.ts";
import {
  byBestPlacement,
  CELEBRATE_WITHIN_DAYS,
  findTopEfforts,
  type CelebratedActivity,
  type TopEffortCelebrations,
  type TopEffortPlacement,
} from "./top-efforts.ts";

const DAY_MS = 86_400_000;

/**
 * After a sync, checks each recent activity whose stream arrived since celebrations were turned
 * on, once, and stores the top 10 efforts it holds now (ADR 0027).
 */
export async function findTopEffortCelebrations(userId: string, now = new Date()) {
  const { topEffortsSince } = await getAthleteSettings(userId);
  if (!topEffortsSince) return;
  const candidates = await db
    .select({ id: activities.id })
    .from(activities)
    .leftJoin(topEffortCelebrations, eq(topEffortCelebrations.activityId, activities.id))
    .where(
      and(
        eq(activities.userId, userId),
        isNull(topEffortCelebrations.activityId),
        inArray(activities.sportType, BESTS_SPORT_TYPES),
        gte(activities.streamsSyncedAt, new Date(topEffortsSince)),
        gte(activities.startDate, new Date(now.getTime() - CELEBRATE_WITHIN_DAYS * DAY_MS)),
      ),
    );
  if (candidates.length === 0) return;

  const ids = new Set(candidates.map((row) => row.id));
  const bests = await loadBestsForUser(userId);
  const found = findTopEfforts(bests.boards, bests.activities, ids, now);
  const byActivity = new Map<string, TopEffortPlacement[]>();
  for (const placement of found) {
    byActivity.set(placement.activity.id, [
      ...(byActivity.get(placement.activity.id) ?? []),
      placement,
    ]);
  }
  await db
    .insert(topEffortCelebrations)
    .values(
      [...ids].map((activityId) => {
        const placements = byActivity.get(activityId) ?? [];
        // Nothing to celebrate: stored seen, so it is never checked again.
        return {
          activityId,
          userId,
          placements,
          foundAt: now,
          seenAt: placements.length ? null : now,
        };
      }),
    )
    .onConflictDoNothing();
  logger.info("top_efforts.found", { checked: ids.size, placements: found.length });
}

export async function loadTopEffortCelebrationsImpl(): Promise<TopEffortCelebrations> {
  const session = await getOptionalSession();
  if (!session) return { activityIds: [], placements: [], activities: {} };
  // The activity is read fresh, so a renamed activity shows its new name on the card's back.
  const rows = await db
    .select({
      activityId: topEffortCelebrations.activityId,
      placements: topEffortCelebrations.placements,
      activity: {
        distance: activities.distance,
        movingTime: activities.movingTime,
        totalElevationGain: activities.totalElevationGain,
        averageHeartrate: activities.averageHeartrate,
        averageWatts: activities.averageWatts,
      },
    })
    .from(topEffortCelebrations)
    .innerJoin(activities, eq(activities.id, topEffortCelebrations.activityId))
    .where(
      and(eq(topEffortCelebrations.userId, session.user.id), isNull(topEffortCelebrations.seenAt)),
    );
  return {
    activityIds: rows.map((row) => row.activityId),
    placements: rows.flatMap((row) => row.placements as TopEffortPlacement[]).sort(byBestPlacement),
    activities: Object.fromEntries(
      rows.map((row): [string, CelebratedActivity] => [row.activityId, row.activity]),
    ),
  };
}

export async function markTopEffortsSeenImpl(activityIds: string[]) {
  const session = await getRequiredSession();
  if (activityIds.length === 0) return;
  await db
    .update(topEffortCelebrations)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(topEffortCelebrations.userId, session.user.id),
        inArray(topEffortCelebrations.activityId, activityIds),
      ),
    );
}
