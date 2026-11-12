import { and, eq, sql } from "drizzle-orm";
import type { ChatMiddleware } from "@tanstack/ai";

import { db } from "@/db/index.ts";
import { coachUsage } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { COACH_FEATURES, type CoachFeature, type CoachProvider } from "./coach-models.ts";
import { dayKey } from "./day-key.ts";
import type { CoachSpending, CoachSpendingMonth } from "./coach-usage.ts";

/**
 * Records what each model call of a coach feature used. TanStack AI calls `onUsage` once per
 * model call that reports usage, so a chat answer that calls tools records each round. A failed
 * write is logged and never stops the coach.
 */
export function recordCoachUsage(
  userId: string,
  feature: CoachFeature,
  provider: CoachProvider,
  model: string,
): ChatMiddleware {
  return {
    name: "coach-usage",
    async onUsage(_ctx, usage) {
      try {
        await db.insert(coachUsage).values({
          id: crypto.randomUUID(),
          userId,
          feature,
          provider,
          model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          costUsd: usage.cost ?? null,
        });
      } catch (error) {
        logger.warn("coach_usage.record_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

function emptyMonth(month: string): CoachSpendingMonth {
  const byFeature = Object.fromEntries(COACH_FEATURES.map(({ id }) => [id, 0])) as Record<
    CoachFeature,
    number
  >;
  return { month, costUsd: 0, calls: 0, byFeature, unpricedCalls: 0, unpricedTokens: 0 };
}

/** This month's and last month's spending, months starting in the athlete's timezone. */
export async function coachSpendingFor(userId: string, timeZone: string): Promise<CoachSpending> {
  const localMonth = sql<string>`to_char(${coachUsage.createdAt} at time zone ${timeZone}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month: localMonth,
      feature: coachUsage.feature,
      priced: sql<boolean>`${coachUsage.costUsd} is not null`,
      costUsd: sql<number>`coalesce(sum(${coachUsage.costUsd}), 0)::float8`,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${coachUsage.inputTokens} + ${coachUsage.outputTokens}), 0)::int`,
    })
    .from(coachUsage)
    .where(
      and(
        eq(coachUsage.userId, userId),
        sql`${coachUsage.createdAt} at time zone ${timeZone} >= date_trunc('month', (now() at time zone ${timeZone}) - interval '1 month')`,
      ),
    )
    .groupBy(sql`1`, coachUsage.feature, sql`3`);

  const thisMonthKey = dayKey(new Date(), timeZone).slice(0, 7);
  const [year, month] = thisMonthKey.split("-").map(Number) as [number, number];
  const thisMonth = emptyMonth(thisMonthKey);
  const lastMonth = emptyMonth(
    month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`,
  );
  for (const row of rows) {
    const bucket = row.month === thisMonth.month ? thisMonth : lastMonth;
    bucket.calls += row.calls;
    if (row.priced) {
      bucket.costUsd += row.costUsd;
      if (row.feature in bucket.byFeature)
        bucket.byFeature[row.feature as CoachFeature] += row.costUsd;
    } else {
      bucket.unpricedCalls += row.calls;
      bucket.unpricedTokens += row.tokens;
    }
  }
  return { thisMonth, lastMonth };
}
