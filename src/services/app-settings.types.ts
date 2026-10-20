import { differenceInYears, isValid } from "date-fns";
import { z } from "zod";

import { shownSportTypesSchema } from "./calendar-settings.types.ts";
import { trainingPlanSchema } from "./training-plan.types.ts";

const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Stored profile: athletes who onboarded before the birthday was required may have none. */
export const profileSettingsSchema = z.object({
  birthDate: birthDateSchema.nullable(),
});

/** Every save carries a birthday, so it can't be cleared once set. */
export const profileSaveSchema = z.object({
  birthDate: birthDateSchema,
});

export const appSettingsSaveSchema = z.object({
  profile: profileSaveSchema,
  sportTypes: shownSportTypesSchema,
  sportGroupShares: z.record(z.string(), z.boolean()),
  training: trainingPlanSchema.optional(),
});

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type ProfileSave = z.infer<typeof profileSaveSchema>;
export type AppSettingsSave = z.infer<typeof appSettingsSaveSchema>;

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  birthDate: null,
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
