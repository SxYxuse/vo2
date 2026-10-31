import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { availabilitySchema, type CoachPlanState } from "./coach-plan.types.ts";

const timeZoneSchema = z
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

export const writeCoachPlanAgain = createServerFn({ method: "POST" }).handler(
  async (): Promise<CoachPlanState> => {
    const { writeCoachPlanAgainImpl } = await import("./coach-plan.server.ts");
    return writeCoachPlanAgainImpl();
  },
);
