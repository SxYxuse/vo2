import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  calendarPeriodSchema,
  planningStyleSchema,
  profileSaveSchema,
  shownSportTypesSchema,
  type AthleteSettings,
  type ProfileSettings,
} from "./athlete-settings.types.ts";
import {
  COACH_FEATURES,
  COACH_PROVIDER_IDS,
  REASONING_LEVELS,
  type CoachModelOption,
  type CoachModels,
} from "./coach-models.ts";
import {
  heartRateSettingsSchema,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "./heart-rate-settings.ts";
import type { FitnessLoad } from "./training-load.ts";

export const athleteSettingsSaveSchema = z.object({
  profile: profileSaveSchema,
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
  calendarPeriod: calendarPeriodSchema.optional(),
  celebrateTopEfforts: z.boolean().optional(),
  heartRate: heartRateSettingsSchema.optional(),
  planningStyle: planningStyleSchema.optional(),
});

export type AthleteSettingsSave = z.infer<typeof athleteSettingsSaveSchema>;

export type SavedAthleteSettings = {
  profile: ProfileSettings;
  settings: AthleteSettings;
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
  provider: z.enum(COACH_PROVIDER_IDS),
  model: z.string(),
  reasoning: z.enum(REASONING_LEVELS).nullable(),
});

/** Every model the picker offers, recommended first (ADR 0060). */
export const loadCoachCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoachModelOption[]> => {
    const { coachCatalog } = await import("./coach-catalog.server.ts");
    return coachCatalog();
  },
);

export const saveCoachModel = createServerFn({ method: "POST" })
  .validator(coachModelSaveSchema)
  .handler(async ({ data }): Promise<CoachModels> => {
    const [{ saveCoachModelImpl }, { findOfferedModel }] = await Promise.all([
      import("./athlete-settings.server.ts"),
      import("./coach-catalog.server.ts"),
    ]);
    const { feature, ...choice } = data;
    const offered = findOfferedModel(choice.provider, choice.model);
    if (!offered || (choice.reasoning != null && !offered.reasoning.includes(choice.reasoning))) {
      throw new Error("Not an offered model and reasoning level");
    }
    return saveCoachModelImpl(feature, choice);
  });
