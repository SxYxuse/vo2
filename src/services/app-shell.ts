import { createServerFn } from "@tanstack/react-start";

import { isTrainingPlanComplete, type TrainingPlan } from "./training-plan.types.ts";

export type AppShellData = {
  signedIn: boolean;
  training: TrainingPlan | null;
  /** False for athletes who onboarded before the birthday was required. */
  hasBirthDate: boolean;
};

export const loadAppShell = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellData> => {
    const { loadAppShellImpl } = await import("./app-shell.server.ts");
    return loadAppShellImpl();
  },
);

/** The app opens once the athlete has a complete training plan and a birthday. */
export function isSetUp(shell: AppShellData) {
  return isTrainingPlanComplete(shell.training) && shell.hasBirthDate;
}
