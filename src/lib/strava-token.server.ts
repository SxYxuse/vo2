import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "@/lib/auth.ts";
import { logger } from "@/lib/logger.server.ts";

export async function getStravaAccessToken(userId: string) {
  const headers = getRequestHeaders();
  const accounts = await auth.api.listUserAccounts({ headers });
  const stravaAccount = accounts.find((account) => account.providerId === "strava");
  if (!stravaAccount) {
    logger.warn("strava.token.missing_account");
    throw new Error("No Strava account is linked to this session");
  }
  const token = await auth.api.getAccessToken({
    headers,
    body: {
      accountId: stravaAccount.id,
      userId,
    },
  });
  if (!token?.accessToken) {
    logger.error("strava.token.missing_access_token", { accountId: stravaAccount.id });
    throw new Error("Could not read a Strava access token");
  }
  logger.debug("strava.token.ok", { accountId: stravaAccount.id });
  return token.accessToken;
}
