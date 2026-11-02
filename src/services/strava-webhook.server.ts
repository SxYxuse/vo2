import { and, eq } from "drizzle-orm";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import { account, activities } from "@/db/schema.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import { removeAthlete } from "./athlete-deletion.server.ts";
import { handleStravaWebhook } from "./strava-webhook.ts";
import { refreshTrainingLoadsForUser } from "./training-load.server.ts";

export function handleStravaWebhookRequest(request: Request) {
  return handleStravaWebhook(
    request,
    {
      // Athlete deletion without the Strava revoke step: the athlete already revoked VO2 there.
      removeAthlete: async (stravaAthleteId) => {
        const userId = await userIdForStravaAthlete(stravaAthleteId);
        if (!userId) return;
        await removeAthlete(userId);
        logger.info("athlete.deleted_on_strava", { userId });
      },
      // Streams and top-effort celebrations cascade from the activity row.
      removeActivity: async (stravaAthleteId, activityId) => {
        const userId = await userIdForStravaAthlete(stravaAthleteId);
        if (!userId) return;
        const removed = await db
          .delete(activities)
          .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
          .returning({ id: activities.id });
        if (!removed.length) return;
        logger.info("activity.deleted_on_strava", { userId, activityId });
        // The load anchors and borrowed heart rates were estimated with this activity included.
        // Rebuilding reads every stream, so it runs after Strava gets its 200 within two seconds.
        void refreshTrainingLoadsForUser(userId).catch((error: unknown) =>
          logger.error("training_load.refresh_failed", errorFields(error)),
        );
      },
    },
    env.STRAVA_WEBHOOK_SECRET,
  );
}

async function userIdForStravaAthlete(stravaAthleteId: string) {
  const [row] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, "strava"), eq(account.accountId, stravaAthleteId)))
    .limit(1);
  return row?.userId;
}
