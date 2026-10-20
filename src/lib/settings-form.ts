import { z } from "zod";

import {
  type ProfileSave,
  type ProfileSettings,
  profileSaveSchema,
} from "@/services/app-settings.types.ts";
import {
  calendarPeriodSchema,
  shownSportTypesSchema,
  type CalendarPeriod,
} from "@/services/calendar-settings.types.ts";
import { DEFAULT_SPORT_GROUP_SHARES } from "@/services/sport-groups.ts";
import {
  DEFAULT_WEEK_MIX,
  suggestedTargetHours,
  weekMixSchema,
  trainingPlanSchema,
  type TrainingPlan,
} from "@/services/training-plan.types.ts";

const BUILD_PACES = ["hold", "slow", "steady", "fast", "overreach"] as const;

// Age checks the max-HR anchor against spikes, so every athlete gives a birthday.
export const profileFormSchema = z.object({
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .refine((value) => value != null, { error: "Pick your birthday." }),
});

const trainingFormFields = trainingPlanSchema.extend({
  buildPace: z
    .union([z.literal(""), z.enum(BUILD_PACES)])
    .pipe(z.enum(BUILD_PACES, { error: "Choose how hard you want to build fitness." })),
  targetMode: z.enum(["auto", "manual"]),
  weekMix: weekMixSchema,
});

export const trainingFormSchema = trainingFormFields;

const sportsFormFields = {
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
};

export const settingsFormSchema = profileFormSchema
  .extend(trainingFormFields.shape)
  .extend(sportsFormFields)
  .extend({ calendarPeriod: calendarPeriodSchema });

export const onboardingFormSchema = profileFormSchema
  .extend(trainingFormFields.shape)
  .extend(sportsFormFields);

export type ProfileFormValues = z.input<typeof profileFormSchema>;
export type TrainingFormValues = z.output<typeof trainingFormSchema>;
export type TrainingFormInput = z.input<typeof trainingFormSchema>;
export type SettingsFormValues = z.output<typeof settingsFormSchema>;
export type SettingsFormInput = z.input<typeof settingsFormSchema>;
export type OnboardingFormValues = z.output<typeof onboardingFormSchema>;
export type OnboardingFormInput = z.input<typeof onboardingFormSchema>;
export type SportsFormInput = Pick<OnboardingFormInput, "sportTypes" | "sportGroupShares">;

export const PROFILE_FIELDS = ["birthDate"] as const satisfies ReadonlyArray<
  keyof OnboardingFormInput
>;
export const TRAINING_PACE_FIELDS = ["buildPace"] as const satisfies ReadonlyArray<
  keyof TrainingFormInput
>;
export const SPORTS_FIELDS = ["sportTypes", "sportGroupShares"] as const satisfies ReadonlyArray<
  keyof OnboardingFormInput
>;
export const TRAINING_WEEK_FIELDS = [
  "targetMode",
  "hoursIntent",
  "targetWeeklyHours",
  "preferredRestWeekday",
] as const satisfies ReadonlyArray<keyof TrainingFormInput>;

export function profileFormDefaults(profile: ProfileSettings | null): ProfileFormValues {
  return { birthDate: profile?.birthDate ?? null };
}

export function profileFromForm(values: ProfileFormValues): ProfileSave {
  return profileSaveSchema.parse({ birthDate: values.birthDate });
}

export function trainingFormDefaults(
  plan: TrainingPlan | null,
  avgHours: number,
  timeZone: string,
): TrainingFormInput {
  if (plan) {
    return {
      buildPace: plan.buildPace,
      targetMode: plan.targetMode,
      hoursIntent: plan.hoursIntent,
      weekMix: plan.weekMix,
      keySessionSports: plan.keySessionSports,
      targetWeeklyHours: plan.targetWeeklyHours,
      preferredRestWeekday: plan.preferredRestWeekday,
      timeZone: plan.timeZone || timeZone,
    };
  }
  return {
    buildPace: "",
    targetMode: "auto",
    hoursIntent: "keep",
    weekMix: DEFAULT_WEEK_MIX,
    keySessionSports: {},
    targetWeeklyHours: suggestedTargetHours(avgHours, "keep"),
    preferredRestWeekday: 0,
    timeZone,
  };
}

export function trainingFromForm(values: TrainingFormValues): TrainingPlan {
  return trainingPlanSchema.parse(values);
}

function sportsFormDefaults(
  sportTypes: SportsFormInput["sportTypes"],
  sportGroupShares: SportsFormInput["sportGroupShares"] | undefined,
): SportsFormInput {
  return {
    sportTypes,
    sportGroupShares: { ...DEFAULT_SPORT_GROUP_SHARES, ...sportGroupShares },
  };
}

export function settingsFormDefaults(input: {
  profile: ProfileSettings | null;
  training: TrainingPlan | null;
  sportTypes: SettingsFormValues["sportTypes"];
  sportGroupShares: SettingsFormValues["sportGroupShares"] | undefined;
  calendarPeriod?: CalendarPeriod;
  avgHours: number;
  timeZone: string;
}): SettingsFormInput {
  return {
    ...profileFormDefaults(input.profile),
    ...trainingFormDefaults(input.training, input.avgHours, input.timeZone),
    ...sportsFormDefaults(input.sportTypes, input.sportGroupShares),
    calendarPeriod: input.calendarPeriod ?? "month",
  };
}

export function onboardingFormDefaults(input: {
  profile: ProfileSettings | null;
  training: TrainingPlan | null;
  sportTypes: OnboardingFormValues["sportTypes"];
  sportGroupShares: OnboardingFormValues["sportGroupShares"] | undefined;
  avgHours: number;
  timeZone: string;
}): OnboardingFormInput {
  return {
    ...profileFormDefaults(input.profile),
    ...trainingFormDefaults(input.training, input.avgHours, input.timeZone),
    ...sportsFormDefaults(input.sportTypes, input.sportGroupShares),
  };
}
