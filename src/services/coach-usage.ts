import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CoachFeature } from "./coach-models.ts";
import { timeZoneSchema } from "./coach-plan.ts";

export type CoachSpendingMonth = {
  month: string;
  costUsd: number;
  byFeature: Record<CoachFeature, number>;
  /** Calls whose provider reported no cost (OpenAI never does), and the tokens they used. */
  unpricedCalls: number;
  unpricedTokens: number;
};

export type CoachSpending = { thisMonth: CoachSpendingMonth; lastMonth: CoachSpendingMonth };

export const getCoachSpending = createServerFn({ method: "GET" })
  .validator(z.object({ timeZone: timeZoneSchema }))
  .handler(async ({ data }): Promise<CoachSpending | null> => {
    const [{ getOptionalSession }, { coachSpendingFor }] = await Promise.all([
      import("@/lib/session.server.ts"),
      import("./coach-usage.server.ts"),
    ]);
    const session = await getOptionalSession();
    if (!session) return null;
    return coachSpendingFor(session.user.id, data.timeZone);
  });
