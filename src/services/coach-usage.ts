import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CoachFeature } from "./coach-models.ts";
import { timeZoneSchema } from "./coach-plan.ts";

export type CoachSpendingMonth = {
  /** YYYY-MM in the athlete's timezone. */
  month: string;
  /** US dollars, over the calls whose provider reported a cost. */
  costUsd: number;
  byFeature: Record<CoachFeature, number>;
  /** Calls whose provider reported no cost (OpenAI never does), and the tokens they used. */
  unpricedCalls: number;
  unpricedTokens: number;
};

export type CoachSpending = { thisMonth: CoachSpendingMonth; lastMonth: CoachSpendingMonth };

/** What the coach cost the athlete on their own keys, this month and last. */
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
