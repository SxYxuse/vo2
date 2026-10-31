import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteProfile, storedPlanningStyle } from "./athlete-settings.server.ts";
import { isProfileComplete, planningStyleOf } from "./athlete-settings.types.ts";
import { isTrainingPlanComplete } from "./training-plan.types.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import type { AppShellData } from "./app-shell.ts";

export async function loadAppShellImpl(): Promise<AppShellData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("app_shell.anonymous");
    return { signedIn: false, training: null, hasProfile: false, planningStyle: null };
  }
  const [training, profile, stored] = await Promise.all([
    getTrainingPlanForUser(session.user.id),
    getAthleteProfile(session.user.id),
    storedPlanningStyle(session.user.id),
  ]);
  const hasProfile = isProfileComplete(profile);
  const planningStyle = planningStyleOf(stored, isTrainingPlanComplete(training));
  logger.debug("app_shell.loaded", { hasTraining: Boolean(training), hasProfile, planningStyle });
  return { signedIn: true, training, hasProfile, planningStyle };
}
