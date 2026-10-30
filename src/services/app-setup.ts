import type { AppShellData } from "./app-shell.ts";
import { isTrainingPlanComplete } from "./training-plan.types.ts";

/** The app opens once the athlete has a complete training plan, a birthday and a weight. */
export function isSetUp(shell: AppShellData) {
  return isTrainingPlanComplete(shell.training) && shell.hasProfile;
}
