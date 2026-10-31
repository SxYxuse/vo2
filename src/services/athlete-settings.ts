import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  calendarPeriodSchema,
  chosenPlanningStyleSchema,
  profileSaveSchema,
  shownSportTypesSchema,
  type AthleteSettings,
  type ProfileSettings,
} from "./athlete-settings.types.ts";
import { COACH_FEATURES, COACH_MODELS, type CoachModels } from "./coach-models.ts";
import {
  heartRateSettingsSchema,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "./heart-rate-settings.ts";
import type { FitnessLoad } from "./training-load.ts";
import { trainingPlanSchema, type TrainingPlan } from "./training-plan.types.ts";

export const athleteSettingsSaveSchema = z.object({
  profile: profileSaveSchema,
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
  calendarPeriod: calendarPeriodSchema.optional(),
  celebrateTopEfforts: z.boolean().optional(),
  training: trainingPlanSchema.optional(),
  heartRate: heartRateSettingsSchema.optional(),
  planningStyle: chosenPlanningStyleSchema.optional(),
});

export type AthleteSettingsSave = z.infer<typeof athleteSettingsSaveSchema>;

export type SavedAthleteSettings = {
  profile: ProfileSettings;
  settings: AthleteSettings;
  training: TrainingPlan | null;
  heartRate: HeartRateSettings;
};

export type SettingsSnapshot = SavedAthleteSettings & {
  signedIn: boolean;
  fitnessLoads: FitnessLoad[];
  /** Shown as placeholders and checked against the athlete's own values. */
  heartRateEstimates: HeartRateEstimates;
};

export const loadSettingsSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsSnapshot> => {
    const { loadSettingsSnapshotImpl } = await import("./athlete-settings.server.ts");
    return loadSettingsSnapshotImpl();
  },
);

export const saveAthleteSettings = createServerFn({ method: "POST" })
  .validator(athleteSettingsSaveSchema)
  .handler(async ({ data }): Promise<SavedAthleteSettings> => {
    const { saveAthleteSettingsImpl } = await import("./athlete-settings.server.ts");
    return saveAthleteSettingsImpl(data);
  });

/** Collects the birthday and weight from athletes who onboarded before they were required. */
export const saveProfile = createServerFn({ method: "POST" })
  .validator(profileSaveSchema)
  .handler(async ({ data }): Promise<void> => {
    const { saveProfileImpl } = await import("./athlete-settings.server.ts");
    await saveProfileImpl(data);
  });

const coachModelSaveSchema = z.object({
  feature: z.enum(COACH_FEATURES.map((feature) => feature.id)),
  model: z.enum(COACH_MODELS.map((model) => model.id)),
});

export const saveCoachModel = createServerFn({ method: "POST" })
  .validator(coachModelSaveSchema)
  .handler(async ({ data }): Promise<CoachModels> => {
    const { saveCoachModelImpl } = await import("./athlete-settings.server.ts");
    return saveCoachModelImpl(data.feature, data.model);
  });
