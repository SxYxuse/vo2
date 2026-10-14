import { cache } from "react";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "#/lib/auth.ts";

export const getOptionalSession = cache(async () => {
  return auth.api.getSession({
    headers: getRequestHeaders(),
  });
});

export async function getRequiredSession() {
  const session = await getOptionalSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
