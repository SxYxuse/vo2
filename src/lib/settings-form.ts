import { z } from "zod";

import {
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  calendarPeriodSchema,
  profileSaveSchema,
  shownSportTypesSchema,
  type CalendarPeriod,
  type ProfileSave,
  type ProfileSettings,
} from "@/services/athlete-settings.types.ts";
import type { AthleteSettingsSave, SavedAthleteSettings } from "@/services/athlete-settings.ts";
import { BPM_MAX, BPM_MIN, ZONED_FAMILIES, type ZonedFamily } from "@/services/heart-rate.ts";
import {
  DEFAULT_HEART_RATE_SETTINGS,
  REST_HR_MAX,
  REST_HR_MIN,
  heartRateSettingsIssues,
  heartRateSettingsSchema,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "@/services/heart-rate-settings.ts";
import { DEFAULT_SPORT_GROUP_SHARES } from "@/services/sport-groups.ts";
import {
  defaultLongWeekday,
  trainingPlanFields,
  trainingPlanSchema,
  withWeekShapeIssues,
  type TrainingPlan,
} from "@/services/training-plan.types.ts";
import { NO_HISTORY_REST_WEEKDAYS } from "@/services/plan-builder.types.ts";

// Age checks the max-HR anchor against spikes, and weight caps caffeine in fuel plans,
// so every athlete gives both.
export const profileFormSchema = z.object({
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .refine((value) => value != null, { error: "Pick your birthday." }),
  weightKg: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value === "") {
        ctx.addIssue({ code: "custom", message: "Enter your weight." });
        return;
      }
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed) && parsed >= MIN_WEIGHT_KG && parsed <= MAX_WEIGHT_KG) return;
      ctx.addIssue({
        code: "custom",
        message: `Enter a weight between ${MIN_WEIGHT_KG} and ${MAX_WEIGHT_KG} kg.`,
      });
    }),
});

// Settings → Training edits the week's shape; the rest of the plan rides along unchanged and
// the server keeps its own copy of the plan goals (ADR 0026).
const trainingFormFields = z.object(trainingPlanFields);

export const trainingFormSchema = withWeekShapeIssues(trainingFormFields);

const sportsFormFields = {
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
};

const sportsFormSchema = z.object(sportsFormFields);

/** Blank means "use the estimate"; anything typed must be a whole bpm in range. */
function bpmText(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || isBpmInRange(value, min, max), {
      error: `Enter a heart rate between ${min} and ${max} bpm, or leave it blank.`,
    });
}

function isBpmInRange(value: string, min: number, max: number) {
  const parsed = Number(value);
  return /^\d+$/.test(value) && parsed >= min && parsed <= max;
}

const sportHeartRateFormSchema = z
  .object({
    method: z.enum(["lthr", "max", "reserve", "custom"]),
    lthr: bpmText(BPM_MIN, BPM_MAX),
    maxHr: bpmText(BPM_MIN, BPM_MAX),
    customZones: z.array(z.string().trim()).length(4),
  })
  .superRefine((value, ctx) => {
    if (value.method !== "custom") return;
    value.customZones.forEach((top, index) => {
      if (isBpmInRange(top, BPM_MIN, BPM_MAX)) return;
      ctx.addIssue({
        code: "custom",
        path: ["customZones", index],
        message: `Enter a heart rate between ${BPM_MIN} and ${BPM_MAX} bpm.`,
      });
    });
  });

const heartRateFormFields = {
  heartRate: z.object({
    restHr: bpmText(REST_HR_MIN, REST_HR_MAX),
    sports: z.object({
      cycling: sportHeartRateFormSchema,
      running: sportHeartRateFormSchema,
      swimming: sportHeartRateFormSchema,
    }),
  }),
};

const heartRateFormSchema = z.object(heartRateFormFields);

export const settingsFormSchema = profileFormSchema
  .extend(trainingFormFields.shape)
  .extend(sportsFormFields)
  .extend(heartRateFormFields)
  .extend({ calendarPeriod: calendarPeriodSchema });

export const onboardingFormSchema = profileFormSchema.extend(sportsFormFields);

export type ProfileFormValues = z.input<typeof profileFormSchema>;
export type TrainingFormValues = z.output<typeof trainingFormSchema>;
export type TrainingFormInput = z.input<typeof trainingFormSchema>;
export type SettingsFormValues = z.output<typeof settingsFormSchema>;
export type SettingsFormInput = z.input<typeof settingsFormSchema>;
export type OnboardingFormValues = z.output<typeof onboardingFormSchema>;
export type OnboardingFormInput = z.input<typeof onboardingFormSchema>;
export type SportsFormInput = Pick<OnboardingFormInput, "sportTypes" | "sportGroupShares">;
export type HeartRateFormInput = z.input<typeof heartRateFormSchema>;
export type SportHeartRateFormInput = HeartRateFormInput["heartRate"]["sports"][ZonedFamily];

export const PROFILE_FIELDS = ["birthDate", "weightKg"] as const satisfies ReadonlyArray<
  keyof OnboardingFormInput
>;
export const SPORTS_FIELDS = ["sportTypes", "sportGroupShares"] as const satisfies ReadonlyArray<
  keyof OnboardingFormInput
>;

export function profileFormDefaults(profile: ProfileSettings | null): ProfileFormValues {
  return {
    birthDate: profile?.birthDate ?? null,
    weightKg: profile?.weightKg != null ? String(profile.weightKg) : "",
  };
}

export function profileFromForm(values: ProfileFormValues): ProfileSave {
  // Phones in comma-decimal locales type "72,5".
  const weightKg = Math.round(Number(values.weightKg.replace(",", ".")) * 10) / 10;
  return profileSaveSchema.parse({ birthDate: values.birthDate, weightKg });
}

export function trainingFormDefaults(
  plan: TrainingPlan | null,
  timeZone: string,
): TrainingFormInput {
  if (plan) return { ...plan, timeZone: plan.timeZone || timeZone };
  return {
    restWeekdays: NO_HISTORY_REST_WEEKDAYS,
    longWeekday: defaultLongWeekday(NO_HISTORY_REST_WEEKDAYS),
    doubleDays: 0,
    sports: ["cycling", "running"],
    goals: null,
    startWeek: null,
    baselineMinutes: null,
    keySessionSports: {},
    timeZone,
  };
}

export function trainingFromForm(values: TrainingFormValues): TrainingPlan {
  return trainingPlanSchema.parse(values);
}

function bpmString(value: number | null) {
  return value == null ? "" : String(value);
}

export function heartRateFormDefaults(settings: HeartRateSettings): HeartRateFormInput {
  const sport = (family: ZonedFamily): SportHeartRateFormInput => {
    const value = settings.sports[family];
    return {
      method: value.method,
      lthr: bpmString(value.lthr),
      maxHr: bpmString(value.maxHr),
      customZones: value.customZones?.map(String) ?? ["", "", "", ""],
    };
  };
  return {
    heartRate: {
      restHr: bpmString(settings.restHr),
      sports: { cycling: sport("cycling"), running: sport("running"), swimming: sport("swimming") },
    },
  };
}

/** The settings the form describes, reading any value that isn't a valid bpm as blank. */
export function heartRateFormPreview(values: HeartRateFormInput): HeartRateSettings {
  const { restHr, sports } = values.heartRate;
  const bpm = (value: string, min = BPM_MIN, max = BPM_MAX) => {
    const trimmed = value.trim();
    return isBpmInRange(trimmed, min, max) ? Number(trimmed) : null;
  };
  const sport = (family: ZonedFamily) => {
    const value = sports[family];
    const tops = value.customZones.map((top) => bpm(top));
    return {
      method: value.method,
      lthr: bpm(value.lthr),
      maxHr: bpm(value.maxHr),
      customZones: tops.every((top) => top != null) ? tops : null,
    };
  };
  return heartRateSettingsSchema.parse({
    restHr: bpm(restHr, REST_HR_MIN, REST_HR_MAX),
    sports: Object.fromEntries(ZONED_FAMILIES.map((family) => [family, sport(family)])),
  });
}

/** The settings the form describes, or null while a typed value is incomplete. */
export function heartRateFromForm(values: HeartRateFormInput): HeartRateSettings | null {
  return heartRateFormSchema.safeParse(values).success ? heartRateFormPreview(values) : null;
}

/**
 * Settings save as the athlete edits, so one half-typed field must not hold back the rest:
 * each part that fails validation keeps its last saved value. Null when nothing valid is known.
 */
export function settingsSaveFromForm(
  values: SettingsFormInput,
  saved: SavedAthleteSettings & { heartRateEstimates?: HeartRateEstimates },
): AthleteSettingsSave | null {
  const profile = profileFormSchema.safeParse(values);
  const training = trainingFormSchema.safeParse(values);
  const sports = sportsFormSchema.safeParse(values);
  const savedProfile = profileSaveSchema.safeParse(saved.profile);
  const profileSave = profile.success
    ? profileFromForm(profile.data)
    : savedProfile.success
      ? savedProfile.data
      : null;
  if (!profileSave) return null;
  const heartRate = heartRateFromForm(values);
  const heartRateValid =
    heartRate != null &&
    (!saved.heartRateEstimates ||
      heartRateSettingsIssues(heartRate, saved.heartRateEstimates).length === 0);
  return {
    profile: profileSave,
    sportTypes: sports.success ? sports.data.sportTypes : saved.settings.sportTypes,
    sportGroupShares: sports.success
      ? sports.data.sportGroupShares
      : (saved.settings.sportGroupShares ?? DEFAULT_SPORT_GROUP_SHARES),
    calendarPeriod: values.calendarPeriod,
    // Only a built plan has a shape to edit; the plan builder creates it.
    training: saved.training
      ? training.success
        ? trainingFromForm(training.data)
        : saved.training
      : undefined,
    heartRate: heartRateValid ? heartRate : saved.heartRate,
  };
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
  heartRate?: HeartRateSettings;
  sportTypes: SettingsFormValues["sportTypes"];
  sportGroupShares: SettingsFormValues["sportGroupShares"] | undefined;
  calendarPeriod?: CalendarPeriod;
  timeZone: string;
}): SettingsFormInput {
  return {
    ...profileFormDefaults(input.profile),
    ...trainingFormDefaults(input.training, input.timeZone),
    ...sportsFormDefaults(input.sportTypes, input.sportGroupShares),
    ...heartRateFormDefaults(input.heartRate ?? DEFAULT_HEART_RATE_SETTINGS),
    calendarPeriod: input.calendarPeriod ?? "month",
  };
}

export function onboardingFormDefaults(input: {
  profile: ProfileSettings | null;
  sportTypes: OnboardingFormValues["sportTypes"];
  sportGroupShares: OnboardingFormValues["sportGroupShares"] | undefined;
}): OnboardingFormInput {
  return {
    ...profileFormDefaults(input.profile),
    ...sportsFormDefaults(input.sportTypes, input.sportGroupShares),
  };
}
