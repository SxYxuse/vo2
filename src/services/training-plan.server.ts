import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { parseTrainingPlan, type TrainingPlan } from "./training-plan.types.ts";

export const getTrainingPlanForUser = cache(
  async (userId: string): Promise<TrainingPlan | null> => {
    const [row] = await db
      .select({ training: athleteMetrics.training })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1);
    return parseTrainingPlan(row?.training);
  },
);

export async function saveTrainingPlanForUser(userId: string, plan: TrainingPlan) {
  logger.info("training_plan.saved", {
    targetWeeklyHours: plan.targetWeeklyHours,
    targetMode: plan.targetMode,
    weekMix: plan.weekMix,
  });
  await db
    .insert(athleteMetrics)
    .values({ userId, training: plan, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: { training: plan, updatedAt: new Date() },
    });
}
