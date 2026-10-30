import { createServerFn } from "@tanstack/react-start";

import type { TrainingPlan } from "./training-plan.types.ts";

export type AppShellData = {
  signedIn: boolean;
  training: TrainingPlan | null;
  /** False for athletes who onboarded before the birthday and weight were required. */
  hasProfile: boolean;
};

export const loadAppShell = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellData> => {
    const { loadAppShellImpl } = await import("./app-shell.server.ts");
    return loadAppShellImpl();
  },
);
