import { differenceInYears, isValid } from "date-fns";
import { z } from "zod";

import { calendarPeriodSchema, shownSportTypesSchema } from "./calendar-settings.types.ts";
import { trainingPlanSchema } from "./training-plan.types.ts";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const profileSettingsSchema = z.object({
  birthDate: isoDate,
  weightKg: z.number().min(20).max(250).nullable(),
  heightCm: z.number().int().min(80).max(250).nullable(),
});

export const appSettingsSaveSchema = z.object({
  profile: profileSettingsSchema,
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
  calendarPeriod: calendarPeriodSchema.optional(),
  training: trainingPlanSchema.optional(),
});

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type AppSettingsSave = z.infer<typeof appSettingsSaveSchema>;

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  birthDate: null,
  weightKg: null,
  heightCm: null,
};

export function parseBirthDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return isValid(date) ? date : null;
}

export function formatBirthDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ageFromBirthDate(value: string | null, now = new Date()) {
  if (!value) return null;
  const birth = parseBirthDate(value);
  if (!birth || birth > now) return null;
  return differenceInYears(now, birth);
}
