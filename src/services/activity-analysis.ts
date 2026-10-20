import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { StoredActivityAnalysis } from "./activity-analysis.types.ts";

export type { CoachSection, StoredActivityAnalysis } from "./activity-analysis.types.ts";
export { parseCoachMarkdown } from "./activity-analysis.types.ts";

export const getAnalysisStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isAnalysisMocked } = await import("./activity-analysis.server.ts");
  return { mocked: isAnalysisMocked() };
});

export const getActivityAnalysis = createServerFn({ method: "GET" })
  .validator(z.object({ activityId: z.string().min(1) }))
  .handler(async ({ data }): Promise<StoredActivityAnalysis | null> => {
    const { getActivityAnalysisImpl } = await import("./activity-analysis.server.ts");
    return getActivityAnalysisImpl(data.activityId);
  });
