import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { athleteMetrics, calendarSettings } from "#/db/schema.ts";
import { getRequiredSession } from "#/lib/session.server.ts";
import type { AppSettingsSave, ProfileSettings } from "./app-settings.types.ts";
import { DEFAULT_PROFILE_SETTINGS } from "./app-settings.types.ts";
import {
  DEFAULT_CALENDAR_SETTINGS,
  mergeCalendarSettings,
  parseCalendarSettings,
  type CalendarSettings,
} from "./calendar-settings.types.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export async function getProfileSettingsForUser(userId: string): Promise<ProfileSettings> {
  const [row] = await db
    .select({
      birthDate: athleteMetrics.birthDate,
      weightKg: athleteMetrics.weightKg,
      heightCm: athleteMetrics.heightCm,
    })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_PROFILE_SETTINGS;
  return {
    birthDate: row.birthDate ?? null,
    weightKg: row.weightKg ?? null,
    heightCm: row.heightCm ?? null,
  };
}

export async function saveAppSettingsImpl(value: AppSettingsSave): Promise<{
  profile: ProfileSettings;
  settings: CalendarSettings;
  training: TrainingPlan | null;
}> {
  const session = await getRequiredSession();
  const stored = (await getCalendarSettingsForUser(session.user.id)) ?? DEFAULT_CALENDAR_SETTINGS;
  const settings = mergeCalendarSettings(
    {
      ...stored,
      sportTypes: value.sportTypes,
      sportGroupShares: value.sportGroupShares,
    },
    Object.keys(value.sportTypes),
  );

  await db
    .insert(athleteMetrics)
    .values({
      userId: session.user.id,
      birthDate: value.profile.birthDate,
      weightKg: value.profile.weightKg,
      heightCm: value.profile.heightCm,
      training: value.training,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: {
        birthDate: value.profile.birthDate,
        weightKg: value.profile.weightKg,
        heightCm: value.profile.heightCm,
        ...(value.training ? { training: value.training } : {}),
        updatedAt: new Date(),
      },
    });

  const parsed = parseCalendarSettings(settings);
  if (!parsed) throw new Error("Invalid calendar settings");

  await db
    .insert(calendarSettings)
    .values({
      userId: session.user.id,
      value: parsed,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: calendarSettings.userId,
      set: {
        value: parsed,
        updatedAt: new Date(),
      },
    });

  const training = value.training ?? (await getTrainingPlanForUser(session.user.id));
  return { profile: value.profile, settings: parsed, training };
}
