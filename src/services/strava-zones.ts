import { createServerFn } from "@tanstack/react-start";

import type { StravaZones } from "@/integrations/strava/client.ts";
import { customZoneTopsRise, customZoneTopsSchema } from "./heart-rate-settings.ts";

/**
 * The tops of zones 1 to 4 from Strava's five heart-rate ranges, or null when VO2 can't save them.
 * Strava starts each zone where the last one ends; VO2's tops are inclusive, so each sits one beat
 * below the next zone's start.
 */
export function zoneTopsFromStrava(zones: StravaZones): number[] | null {
  const ranges = zones.heart_rate?.zones;
  if (ranges?.length !== 5) return null;
  const tops = ranges.slice(1).map((range) => (range.min ?? 0) - 1);
  return customZoneTopsSchema.safeParse(tops).success && customZoneTopsRise(tops) ? tops : null;
}

/** One-time copy: Strava keeps one set of heart-rate zones for every sport. */
export const loadStravaZoneTops = createServerFn({ method: "GET" }).handler(
  async (): Promise<number[]> => {
    const { loadStravaZoneTopsImpl } = await import("./strava-zones.server.ts");
    return loadStravaZoneTopsImpl();
  },
);
