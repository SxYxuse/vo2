import { createServerFn } from "@tanstack/react-start";

import type { ActivityMapData } from "./activity-map.types.ts";

export type { ActivityMapData, ActivityMapTrack, MapSportOption } from "./activity-map.types.ts";
export {
  ALL_SPORTS,
  boundsOf,
  focusBoundsOf,
  decodePolyline,
  mapSportOptions,
} from "./activity-map.types.ts";

export const loadActivityMap = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivityMapData> => {
    const { loadActivityMapImpl } = await import("./activity-map.server.ts");
    return loadActivityMapImpl();
  },
);
