import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, athleteMetrics, calendarSettings } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import type { AppSettingsSave, ProfileSettings } from "./app-settings.types.ts";
import { DEFAULT_PROFILE_SETTINGS } from "./app-settings.types.ts";
import {
  DEFAULT_CALENDAR_SETTINGS,
  mergeCalendarSettings,
  parseCalendarSettings,
  type CalendarSettings,
} from "./calendar-settings.types.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { toFitnessLoad, type FitnessLoad } from "./training-load.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export type SettingsSnapshot = {
  signedIn: boolean;
  fitnessLoads: FitnessLoad[];
  profile: ProfileSettings;
  settings: CalendarSettings;
  training: TrainingPlan | null;
};

export const getProfileSettingsForUser = cache(async (userId: string): Promise<ProfileSettings> => {
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
});

export async function loadSettingsSnapshotImpl(): Promise<SettingsSnapshot> {
  const session = await getOptionalSession();
  if (!session) {
    return {
      signedIn: false,
      fitnessLoads: [],
      profile: DEFAULT_PROFILE_SETTINGS,
      settings: DEFAULT_CALENDAR_SETTINGS,
      training: null,
    };
  }
  const [profile, storedSettings, training, loadRows] = await Promise.all([
    getProfileSettingsForUser(session.user.id),
    getCalendarSettingsForUser(session.user.id),
    getTrainingPlanForUser(session.user.id),
    db
      .select({
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        trainingLoad: activities.trainingLoad,
        loadSource: activities.loadSource,
        sportType: activities.sportType,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id)),
  ]);
  return {
    signedIn: true,
    profile,
    settings: mergeCalendarSettings(
      storedSettings,
      loadRows.map((row) => row.sportType),
    ),
    training,
    fitnessLoads: loadRows.map((row) =>
      toFitnessLoad(
        row.startDate,
        row.trainingLoad ?? 0,
        row.loadSource ?? "duration",
        row.movingTime,
      ),
    ),
  };
}

export async function saveAppSettingsImpl(value: AppSettingsSave): Promise<{
  profile: ProfileSettings;
  settings: CalendarSettings;
  training: TrainingPlan | null;
}> {
  const session = await getRequiredSession();
  const [stored, sportTypeRows] = await Promise.all([
    getCalendarSettingsForUser(session.user.id),
    db
      .select({ sportType: activities.sportType })
      .from(activities)
      .where(eq(activities.userId, session.user.id)),
  ]);
  const settings = mergeCalendarSettings(
    {
      ...(stored ?? DEFAULT_CALENDAR_SETTINGS),
      sportTypes: {
        ...stored?.sportTypes,
        ...value.sportTypes,
      },
      sportGroupShares: value.sportGroupShares,
    },
    [...sportTypeRows.map((row) => row.sportType), ...Object.keys(value.sportTypes)],
  );

  const parsed = parseCalendarSettings(settings);
  if (!parsed) throw new Error("Invalid calendar settings");

  await Promise.all([
    db
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
      }),
    db
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
      }),
  ]);

  const training = value.training ?? (await getTrainingPlanForUser(session.user.id));
  logger.info("settings.saved", { hasTraining: Boolean(training) });
  return { profile: value.profile, settings: parsed, training };
}
