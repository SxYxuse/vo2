import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { user } from "@/db/schema.ts";
import { StravaApi } from "@/integrations/strava/client.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import { getStravaAccessToken } from "@/lib/strava-token.server.ts";
import { deleteAthlete } from "./athlete-deletion.ts";

export async function deleteCurrentAthleteImpl() {
  const session = await getRequiredSession();
  const result = await deleteAthlete(session.user.id, {
    revokeStrava: async (userId) => {
      try {
        await new StravaApi(await getStravaAccessToken(userId)).deauthorize();
      } catch (error) {
        logger.warn("athlete.strava_revoke_failed", errorFields(error));
        throw error;
      }
    },
    removeAthlete,
  });
  logger.info("athlete.deleted", result);
  return result;
}

/** Every athlete table cascades from the user row, sessions and the Strava link included. */
export async function removeAthlete(userId: string) {
  await db.delete(user).where(eq(user.id, userId));
}

/** False once the athlete was deleted mid-request, so long-running work can stop quietly. */
export async function athleteExists(userId: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  return Boolean(row);
}
