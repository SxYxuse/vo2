import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "#/lib/auth.ts";

export async function getStravaAccessToken(userId: string) {
  const headers = getRequestHeaders();
  const accounts = await auth.api.listUserAccounts({ headers });
  const stravaAccount = accounts.find((account) => account.providerId === "strava");
  if (!stravaAccount) {
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
    throw new Error("Could not read a Strava access token");
  }
  return token.accessToken;
}
