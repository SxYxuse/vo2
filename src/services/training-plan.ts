import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { PlannedSession, TrainingPlan } from "./training-plan.types.ts";
import { trainingPlanSchema } from "./training-plan.types.ts";

export type {
  BuildPace,
  HoursIntent,
  PlannedSession,
  TrainingPlan,
  WorkoutStyle,
} from "./training-plan.types.ts";
export {
  BUILD_PACES,
  HOURS_INTENTS,
  TIME_WINDOWS,
  WEEKDAYS,
  WORKOUT_STYLES,
  addDayKey,
  dayKey,
  formatHours,
  isTrainingPlanComplete,
  openWeekBucket,
  parseTrainingPlan,
  recentAverageWeeklyHours,
  sessionFitsWindow,
  suggestedTargetHours,
  trainingConsistency,
  trainingPlanSchema,
  weekStartKey,
} from "./training-plan.types.ts";

export const PLAN_EVENT_PREFIX = "plan:";

export function plannedEventId(id: string) {
  return `${PLAN_EVENT_PREFIX}${id}`;
}

export function isPlannedEventId(id: string) {
  return id.startsWith(PLAN_EVENT_PREFIX);
}

export function plannedSessionIdFromEvent(id: string) {
  return id.slice(PLAN_EVENT_PREFIX.length);
}

export const saveTrainingPlan = createServerFn({ method: "POST" })
  .validator(trainingPlanSchema)
  .handler(async ({ data }): Promise<TrainingPlan> => {
    const { getRequiredSession } = await import("#/lib/session.server.ts");
    const { saveTrainingPlanForUser } = await import("./training-plan.server.ts");
    const session = await getRequiredSession();
    await saveTrainingPlanForUser(session.user.id, data);
    return data;
  });

export const suggestWeek = createServerFn({ method: "POST" })
  .validator(z.object({ timeZone: z.string().min(1) }))
  .handler(async ({ data }): Promise<PlannedSession[]> => {
    const { suggestWeekImpl } = await import("./training-plan.server.ts");
    return suggestWeekImpl(data.timeZone);
  });
