import type { AppShellData } from "./app-shell.ts";

export function isSetUp(shell: AppShellData) {
  return shell.planningStyle != null && shell.hasProfile;
}
