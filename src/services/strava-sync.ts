import { createServerFn } from "@tanstack/react-start";

import type { HomeData, SyncResult, SyncStatus } from "./strava-sync.types.ts";

export type { HomeData, SyncResult, SyncStatus } from "./strava-sync.types.ts";

export const loadHomeData = createServerFn({ method: "GET" }).handler(
  async (): Promise<HomeData> => {
    const { loadHomeDataImpl } = await import("./strava-sync.server.ts");
    return loadHomeDataImpl();
  },
);

export const loadSyncStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SyncStatus> => {
    const { loadSyncStatusImpl } = await import("./strava-sync.server.ts");
    return loadSyncStatusImpl();
  },
);

export const syncStrava = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncResult> => {
    const { syncStravaImpl } = await import("./strava-sync.server.ts");
    return syncStravaImpl();
  },
);
