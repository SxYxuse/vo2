import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import type { AppShellData } from "./app-shell.ts";

export async function loadAppShellImpl(): Promise<AppShellData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("app_shell.anonymous");
    return { signedIn: false, training: null };
  }
  const training = await getTrainingPlanForUser(session.user.id);
  logger.debug("app_shell.loaded", { hasTraining: Boolean(training) });
  return { signedIn: true, training };
}
