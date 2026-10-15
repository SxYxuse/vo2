import { getOptionalSession } from "#/lib/session.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import type { AppShellData } from "./app-shell.ts";

export async function loadAppShellImpl(): Promise<AppShellData> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, training: null };
  const training = await getTrainingPlanForUser(session.user.id);
  return { signedIn: true, training };
}
