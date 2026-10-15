import { cache } from "react";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "#/lib/auth.ts";
import { setLogUserId } from "#/lib/log-context.server.ts";
import { logger } from "#/lib/logger.server.ts";

export const getOptionalSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  });
  setLogUserId(session?.user.id);
  return session;
});

export async function getRequiredSession() {
  const session = await getOptionalSession();
  if (!session) {
    logger.warn("session.unauthorized");
    throw new Error("Unauthorized");
  }
  return session;
}
