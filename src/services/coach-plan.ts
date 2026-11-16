import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  availabilitySchema,
  briefSchema,
  progressionSchema,
  type CoachPlanState,
} from "./coach-plan.types.ts";

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
      return true;
    } catch {
      return false;
    }
  });

export const loadCoachPlan = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoachPlanState> => {
    const { loadCoachPlanImpl } = await import("./coach-plan.server.ts");
    return loadCoachPlanImpl();
  },
);

export const saveCoachPlanAvailability = createServerFn({ method: "POST" })
  .validator(z.object({ availability: availabilitySchema, timeZone: timeZoneSchema }))
  .handler(async ({ data }): Promise<CoachPlanState> => {
    const { saveAvailabilityImpl } = await import("./coach-plan.server.ts");
    return saveAvailabilityImpl(data.availability, data.timeZone);
  });

export const saveCoachPlanProgression = createServerFn({ method: "POST" })
  .validator(z.object({ progression: progressionSchema }))
  .handler(async ({ data }): Promise<CoachPlanState> => {
    const { saveProgressionImpl } = await import("./coach-plan.server.ts");
    return saveProgressionImpl(data.progression);
  });

export const saveCoachPlanBrief = createServerFn({ method: "POST" })
  .validator(z.object({ brief: briefSchema }))
  .handler(async ({ data }): Promise<CoachPlanState> => {
    const { saveBriefImpl } = await import("./coach-plan.server.ts");
    return saveBriefImpl(data.brief);
  });

export const writeCoachPlanAgain = createServerFn({ method: "POST" }).handler(
  async (): Promise<CoachPlanState> => {
    const { writeCoachPlanAgainImpl } = await import("./coach-plan.server.ts");
    return writeCoachPlanAgainImpl();
  },
);

export const markCoachPlanSession = createServerFn({ method: "POST" })
  .validator(z.object({ sessionId: z.string().min(1).max(64), done: z.boolean() }))
  .handler(async ({ data }): Promise<CoachPlanState> => {
    const { markSessionImpl } = await import("./coach-plan.server.ts");
    return markSessionImpl(data.sessionId, data.done);
  });
