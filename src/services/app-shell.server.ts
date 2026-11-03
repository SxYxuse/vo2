import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteProfile, storedPlanningStyle } from "./athlete-settings.server.ts";
import { isProfileComplete } from "./athlete-settings.types.ts";
import type { AppShellData } from "./app-shell.ts";

export async function loadAppShellImpl(): Promise<AppShellData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("app_shell.anonymous");
    return { signedIn: false, hasProfile: false, planningStyle: null };
  }
  const [profile, planningStyle] = await Promise.all([
    getAthleteProfile(session.user.id),
    storedPlanningStyle(session.user.id),
  ]);
  const hasProfile = isProfileComplete(profile);
  logger.debug("app_shell.loaded", { hasProfile, planningStyle });
  return { signedIn: true, hasProfile, planningStyle };
}
