import { and, eq } from "drizzle-orm";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import { account, activities } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { removeAthlete } from "./athlete-deletion.server.ts";
import { handleStravaWebhook } from "./strava-webhook.ts";

export function handleStravaWebhookRequest(request: Request) {
  return handleStravaWebhook(
    request,
    {
      // Athlete deletion without the Strava revoke step: the athlete already revoked VO2 there.
      removeAthlete: async (stravaAthleteId) => {
        const [row] = await db
          .select({ userId: account.userId })
          .from(account)
          .where(and(eq(account.providerId, "strava"), eq(account.accountId, stravaAthleteId)))
          .limit(1);
        if (!row) return;
        await removeAthlete(row.userId);
        logger.info("athlete.deleted_on_strava", { userId: row.userId });
      },
      // Streams, analyses and top-effort celebrations cascade from the activity row.
      removeActivity: async (stravaAthleteId, activityId) => {
        const removed = await db
          .delete(activities)
          .where(and(eq(activities.id, activityId), eq(activities.athleteId, stravaAthleteId)))
          .returning({ userId: activities.userId });
        if (removed.length) logger.info("activity.deleted_on_strava", { activityId });
      },
    },
    env.STRAVA_WEBHOOK_SECRET,
  );
}
