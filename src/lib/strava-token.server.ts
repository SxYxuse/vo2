import { getRequestHeaders } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";

import { auth } from "@/lib/auth.ts";
import { logger } from "@/lib/logger.server.ts";
import { STRAVA_RECONNECT_MESSAGE } from "@/services/strava-sync.types.ts";

export async function getStravaAccessToken(userId: string) {
  const headers = getRequestHeaders();
  const accounts = await auth.api.listUserAccounts({ headers });
  const stravaAccount = accounts.find((account) => account.providerId === "strava");
  if (!stravaAccount) {
    logger.warn("strava.token.missing_account");
    throw new Error("No Strava account is linked to this session");
  }
  let token;
  try {
    token = await auth.api.getAccessToken({
      headers,
      body: {
        accountId: stravaAccount.id,
        userId,
      },
    });
  } catch (error) {
    // better-auth throws this, and drops Strava's reason, once the stored token expired and the
    // refresh was refused: the athlete deauthorized VO2, or another deployment sharing the Strava
    // app revoked it (issue #59).
    if (error instanceof APIError && error.body?.code === "FAILED_TO_GET_ACCESS_TOKEN") {
      logger.warn("strava.token.refresh_failed", { accountId: stravaAccount.id });
      throw new Error(STRAVA_RECONNECT_MESSAGE);
    }
    throw error;
  }
  if (!token?.accessToken) {
    logger.error("strava.token.missing_access_token", { accountId: stravaAccount.id });
    throw new Error("Could not read a Strava access token");
  }
  logger.debug("strava.token.ok", { accountId: stravaAccount.id });
  return token.accessToken;
}
