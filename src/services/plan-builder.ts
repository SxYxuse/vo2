import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  planDraftSchema,
  type BuilderData,
  type PlanPreview,
  type SeasonCheck,
} from "./plan-builder.types.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export const loadPlanBuilder = createServerFn({ method: "GET" })
  .validator(z.object({ timeZone: z.string().min(1) }))
  .handler(async ({ data }): Promise<BuilderData> => {
    const { loadPlanBuilderImpl } = await import("./plan-builder.server.ts");
    return loadPlanBuilderImpl(data.timeZone);
  });

export const previewPlan = createServerFn({ method: "POST" })
  .validator(planDraftSchema)
  .handler(async ({ data }): Promise<PlanPreview> => {
    const { previewPlanImpl } = await import("./plan-builder.server.ts");
    return previewPlanImpl(data);
  });

export const startPlan = createServerFn({ method: "POST" })
  .validator(planDraftSchema)
  .handler(async ({ data }): Promise<TrainingPlan> => {
    const { startPlanImpl } = await import("./plan-builder.server.ts");
    return startPlanImpl(data);
  });

/** Takes Season's goals into the plan after the athlete chose to adapt it. */
export const adaptPlan = createServerFn({ method: "POST" }).handler(
  async (): Promise<TrainingPlan | null> => {
    const { adaptPlanImpl } = await import("./plan-builder.server.ts");
    return adaptPlanImpl();
  },
);

/** After a goal changes on Season: adopted at once, or the weeks it would reshape. */
export const checkSeason = createServerFn({ method: "POST" }).handler(
  async (): Promise<SeasonCheck> => {
    const { checkSeasonImpl } = await import("./plan-builder.server.ts");
    return checkSeasonImpl();
  },
);
