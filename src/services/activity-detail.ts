import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { ActivityDetail } from "./activity-detail.types.ts";

export type {
  ActivityChartPoint,
  ActivityDetail,
  ActivityFieldTestSummary,
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
  formatSpeed,
  formatWatts,
} from "./activity-detail.types.ts";
export {
  chartLocomotionValue,
  defaultVisibleSeries,
  formatLocomotion,
  formatPaceClock,
  locomotionFor,
  normalizeSeriesPoint,
} from "./locomotion.ts";

export const getActivityDetail = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<ActivityDetail | null> => {
    const { getActivityDetailImpl } = await import("./activity-detail.server.ts");
    return getActivityDetailImpl(data.id);
  });
