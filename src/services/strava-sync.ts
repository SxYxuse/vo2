import { createServerFn } from "@tanstack/react-start";

import type { HomeData, SyncResult } from "./strava-sync.types.ts";

export const loadHomeData = createServerFn({ method: "GET" }).handler(
  async (): Promise<HomeData> => {
    const { loadHomeDataImpl } = await import("./strava-sync.server.ts");
    return loadHomeDataImpl();
  },
);

export const syncStrava = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncResult> => {
    const { syncStravaImpl } = await import("./strava-sync.server.ts");
    return syncStravaImpl();
  },
);
