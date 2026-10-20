import { createServerFn } from "@tanstack/react-start";

import type { TrainingPlan } from "./training-plan.types.ts";
import {
  keySessionSportSchema,
  trainingPlanSchema,
  withKeySessionSport,
} from "./training-plan.types.ts";

export type {
  BuildPace,
  HoursIntent,
  TargetMode,
  TrainingPlan,
  KeySession,
  KeySessionKind,
  SessionHistory,
  WeekMix,
  KeySessionPresetId,
  TargetZone,
} from "./training-plan.types.ts";
export {
  BUILD_PACES,
  HOURS_INTENTS,
  TARGET_MODES,
  WEEKDAYS,
  HR_TARGET_ZONES,
  KEY_SESSION_PRESETS,
  KEY_SHARE_PRESETS,
  MAX_SESSIONS_PER_WEEK,
  MAX_KEY_SESSIONS,
  addDayKey,
  dayKey,
  formatHours,
  hasRecentWeeklyHours,
  easySessionRange,
  isTrainingPlanComplete,
  keySessionCount,
  keySessionFromPreset,
  keySessionMinutes,
  keySessionName,
  keySessionWorkMinutes,
  parseTrainingPlan,
  recentAverageWeeklyHours,
  recentSessionHistory,
  suggestedTargetHours,
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
