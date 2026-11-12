import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { availabilitySchema, progressionSchema, type CoachPlanState } from "./coach-plan.types.ts";

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

/** The coach plan as stored; starts writing when one is due (ADR 0037). */
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

/** Saves how each sport's budget grows and the athlete's own peaks (ADR 0058). */
export const saveCoachPlanProgression = createServerFn({ method: "POST" })
  .validator(z.object({ progression: progressionSchema }))
  .handler(async ({ data }): Promise<CoachPlanState> => {
    const { saveProgressionImpl } = await import("./coach-plan.server.ts");
    return saveProgressionImpl(data.progression);
  });

export const writeCoachPlanAgain = createServerFn({ method: "POST" }).handler(
  async (): Promise<CoachPlanState> => {
    const { writeCoachPlanAgainImpl } = await import("./coach-plan.server.ts");
    return writeCoachPlanAgainImpl();
  },
);

/** Marks a coach-plan session done, or open again with `done: false` (ADR 0048). */
export const markCoachPlanSession = createServerFn({ method: "POST" })
  .validator(z.object({ sessionId: z.string().min(1).max(64), done: z.boolean() }))
  .handler(async ({ data }): Promise<CoachPlanState> => {
    const { markSessionImpl } = await import("./coach-plan.server.ts");
    return markSessionImpl(data.sessionId, data.done);
  });
