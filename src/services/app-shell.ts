import { createServerFn } from "@tanstack/react-start";

import type { PlanningStyle } from "./athlete-settings.types.ts";

export type AppShellData = {
  signedIn: boolean;
  /** False for athletes who onboarded before the birthday and weight were required. */
  hasProfile: boolean;
  /** Null until the athlete picks one in onboarding. */
  planningStyle: PlanningStyle | null;
};

export const loadAppShell = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellData> => {
    const { loadAppShellImpl } = await import("./app-shell.server.ts");
    return loadAppShellImpl();
  },
);
