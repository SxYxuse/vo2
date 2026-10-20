import { z } from "zod";

import { type ProfileSettings, profileSettingsSchema } from "@/services/app-settings.types.ts";
import { shownSportTypesSchema } from "@/services/calendar-settings.types.ts";
import { DEFAULT_SPORT_GROUP_SHARES } from "@/services/sport-groups.ts";
import {
  suggestedTargetHours,
  trainingConsistency,
  trainingPlanSchema,
  type TrainingPlan,
} from "@/services/training-plan.types.ts";

const BUILD_PACES = ["hold", "slow", "steady", "fast", "overreach"] as const;

export const profileFormSchema = z.object({
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  weightKg: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (Number.isFinite(Number(value)) && Number(value) >= 20 && Number(value) <= 250),
      { error: "Enter a weight between 20 and 250 kg." },
    ),
  heightCm: z
    .string()
    .trim()
    .refine(
      (value) => {
        if (value === "") return true;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 80 && parsed <= 250;
      },
      { error: "Enter a whole height between 80 and 250 cm." },
    ),
});

const trainingFormFields = trainingPlanSchema.extend({
  buildPace: z
    .union([z.literal(""), z.enum(BUILD_PACES)])
    .pipe(z.enum(BUILD_PACES, { error: "Choose how hard you want to build fitness." })),
  maxDoubleDays: z.number().int().min(0).max(6),
  workoutStyle: z.enum(["hours", "structured"]),
});

function withTrainingConsistency<Schema extends z.ZodType>(schema: Schema) {
  return schema.superRefine((value, ctx) => {
    const result = trainingConsistency(value as TrainingPlan);
    if (!result.ok && result.message) {
      ctx.addIssue({
        code: "custom",
        message: result.message,
        path: ["targetWeeklyHours"],
      });
    }
  });
}

export const trainingFormSchema = withTrainingConsistency(trainingFormFields);

const sportsFormFields = {
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
};

export const settingsFormSchema = withTrainingConsistency(
  profileFormSchema.extend(trainingFormFields.shape).extend(sportsFormFields),
);

export const onboardingFormSchema = withTrainingConsistency(
  trainingFormFields.extend(sportsFormFields),
);

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
export type TrainingFormValues = z.output<typeof trainingFormSchema>;
export type TrainingFormInput = z.input<typeof trainingFormSchema>;
export type SettingsFormValues = z.output<typeof settingsFormSchema>;
export type SettingsFormInput = z.input<typeof settingsFormSchema>;
export type OnboardingFormValues = z.output<typeof onboardingFormSchema>;
export type OnboardingFormInput = z.input<typeof onboardingFormSchema>;
export type SportsFormInput = Pick<OnboardingFormInput, "sportTypes" | "sportGroupShares">;

export const TRAINING_PACE_FIELDS = ["buildPace"] as const satisfies ReadonlyArray<
  keyof TrainingFormInput
>;
export const SPORTS_FIELDS = ["sportTypes", "sportGroupShares"] as const satisfies ReadonlyArray<
  keyof OnboardingFormInput
>;
export const TRAINING_WEEK_FIELDS = [
  "maxRunSessions",
  "maxRideSessions",
  "hoursIntent",
  "targetWeeklyHours",
  "preferredRestWeekday",
] as const satisfies ReadonlyArray<keyof TrainingFormInput>;

export function profileFormDefaults(profile: ProfileSettings | null): ProfileFormValues {
  return {
    birthDate: profile?.birthDate ?? null,
    weightKg: profile?.weightKg != null ? String(profile.weightKg) : "",
    heightCm: profile?.heightCm != null ? String(profile.heightCm) : "",
  };
}

export function profileFromForm(values: ProfileFormValues): ProfileSettings {
  return profileSettingsSchema.parse({
    birthDate: values.birthDate,
    weightKg: values.weightKg.trim() === "" ? null : Number(values.weightKg),
    heightCm: values.heightCm.trim() === "" ? null : Number(values.heightCm),
  });
}

export function trainingFormDefaults(
  plan: TrainingPlan | null,
  avgHours: number,
  timeZone: string,
): TrainingFormInput {
  if (plan) {
    return {
      buildPace: plan.buildPace,
      maxRunSessions: plan.maxRunSessions,
      maxRideSessions: plan.maxRideSessions,
      maxDoubleDays: plan.maxDoubleDays,
      hoursIntent: plan.hoursIntent,
      workoutStyle: plan.workoutStyle,
      targetWeeklyHours: plan.targetWeeklyHours,
      preferredRestWeekday: plan.preferredRestWeekday,
      timeZone: plan.timeZone || timeZone,
    };
  }
  return {
    buildPace: "",
    maxRunSessions: 3,
    maxRideSessions: 2,
    maxDoubleDays: 0,
    hoursIntent: "keep",
    workoutStyle: "hours",
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
  avgHours: number;
  timeZone: string;
}): SettingsFormInput {
  return {
    ...profileFormDefaults(input.profile),
    ...trainingFormDefaults(input.training, input.avgHours, input.timeZone),
    ...sportsFormDefaults(input.sportTypes, input.sportGroupShares),
  };
}

export function onboardingFormDefaults(input: {
  training: TrainingPlan | null;
  sportTypes: OnboardingFormValues["sportTypes"];
  sportGroupShares: OnboardingFormValues["sportGroupShares"] | undefined;
  avgHours: number;
  timeZone: string;
}): OnboardingFormInput {
  return {
    ...trainingFormDefaults(input.training, input.avgHours, input.timeZone),
    ...sportsFormDefaults(input.sportTypes, input.sportGroupShares),
  };
}
