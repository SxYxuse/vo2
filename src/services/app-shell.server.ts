import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getProfileSettingsForUser } from "./app-settings.server.ts";
import { isProfileComplete } from "./app-settings.types.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import type { AppShellData } from "./app-shell.ts";

export async function loadAppShellImpl(): Promise<AppShellData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("app_shell.anonymous");
    return { signedIn: false, training: null, hasProfile: false };
  }
  const [training, profile] = await Promise.all([
    getTrainingPlanForUser(session.user.id),
    getProfileSettingsForUser(session.user.id),
  ]);
  const hasProfile = isProfileComplete(profile);
  logger.debug("app_shell.loaded", { hasTraining: Boolean(training), hasProfile });
  return { signedIn: true, training, hasProfile };
}
