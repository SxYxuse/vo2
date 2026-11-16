import { createServerFn } from "@tanstack/react-start";

import type { PlanningStyle } from "./athlete-settings.types.ts";

export type AppShellData = {
  signedIn: boolean;
  hasProfile: boolean;
  planningStyle: PlanningStyle | null;
};

export const loadAppShell = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellData> => {
    const { loadAppShellImpl } = await import("./app-shell.server.ts");
    return loadAppShellImpl();
  },
);
