import { createServerFn } from "@tanstack/react-start";

import type { TrainingPlan } from "./training-plan.types.ts";
import {
  keySessionSportSchema,
  trainingPlanSchema,
  withKeySessionSport,
} from "./training-plan.types.ts";

export type {
  BuildPace,
  TrainingPlan,
  KeySession,
  KeySport,
  KeySessionKind,
  SessionHistory,
  KeySessionPresetId,
  PlanSport,
  TargetZone,
  WeekShape,
} from "./training-plan.types.ts";
export {
  WEEKDAYS,
  HR_TARGET_ZONES,
  KEY_SESSION_PRESETS,
  KEY_SPORTS,
  MAX_DOUBLE_DAYS,
  MAX_KEY_SESSIONS,
  MAX_REST_DAYS,
  PLAN_SPORTS,
  isKeySport,
  addDayKey,
  dayKey,
  formatHours,
  hasRecentWeeklyHours,
  isTrainingPlanComplete,
  keySessionFromPreset,
  keySessionMinutes,
  keySessionName,
  keySessionWorkMinutes,
  parseTrainingPlan,
  recentAverageWeeklyHours,
  recentSessionHistory,
  trainingDayCount,
  trainingPlanSchema,
  weekStartKey,
  zoneLabel,
} from "./training-plan.types.ts";

export const saveTrainingPlan = createServerFn({ method: "POST" })
  .validator(trainingPlanSchema)
  .handler(async ({ data }): Promise<TrainingPlan> => {
    const { getRequiredSession } = await import("@/lib/session.server.ts");
    const { saveTrainingPlanForUser } = await import("./training-plan.server.ts");
    const session = await getRequiredSession();
    await saveTrainingPlanForUser(session.user.id, data);
    return data;
  });

export const saveKeySessionSport = createServerFn({ method: "POST" })
  .validator(keySessionSportSchema)
  .handler(async ({ data }): Promise<TrainingPlan> => {
    const { getRequiredSession } = await import("@/lib/session.server.ts");
    const { getTrainingPlanForUser, saveTrainingPlanForUser } =
      await import("./training-plan.server.ts");
    const session = await getRequiredSession();
    const plan = await getTrainingPlanForUser(session.user.id);
    if (!plan) throw new Error("Finish your training plan first.");
    const next = { ...plan, keySessionSports: withKeySessionSport(plan.keySessionSports, data) };
    await saveTrainingPlanForUser(session.user.id, next);
    return next;
  });
