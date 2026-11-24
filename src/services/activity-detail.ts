import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { ActivityDetail } from "./activity-detail.types.ts";

export type {
  ActivityChartPoint,
  ActivityDetail,
  StreamSeriesKey,
} from "./activity-detail.types.ts";
export {
  STREAM_SERIES,
  formatActivityClockRange,
  formatActivitySchedule,
  formatBpm,
  formatCadence,
  formatDistanceKm,
  formatDuration,
  formatElapsedTick,
  formatElevation,
  formatWatts,
} from "./activity-detail.types.ts";
export {
  defaultVisibleSeries,
  formatLocomotion,
  formatPaceClock,
  locomotionFor,
} from "./locomotion.ts";

export const getActivityDetail = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<ActivityDetail | null> => {
    const { getActivityDetailImpl } = await import("./activity-detail.server.ts");
    return getActivityDetailImpl(data.id);
  });
