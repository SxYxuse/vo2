import type { AppShellData } from "./app-shell.ts";

/**
 * The app opens once the athlete has a birthday, a weight, and a planning style. The week
 * planner's style is saved with its plan, so it always has one.
 */
export function isSetUp(shell: AppShellData) {
  return shell.planningStyle != null && shell.hasProfile;
}
