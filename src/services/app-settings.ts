import { createServerFn } from "@tanstack/react-start";

import {
  appSettingsSaveSchema,
  profileSaveSchema,
  type ProfileSettings,
} from "./app-settings.types.ts";
import type { CalendarSettings } from "./calendar-settings.types.ts";
import type { FitnessLoad } from "./training-load.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export type { AppSettingsSave, ProfileSave, ProfileSettings } from "./app-settings.types.ts";
export {
  DEFAULT_PROFILE_SETTINGS,
  ageFromBirthDate,
  formatBirthDate,
  parseBirthDate,
  profileSaveSchema,
  profileSettingsSchema,
} from "./app-settings.types.ts";

export type SavedAppSettings = {
  profile: ProfileSettings;
  settings: CalendarSettings;
  training: TrainingPlan | null;
};

export type SettingsSnapshot = {
  signedIn: boolean;
  fitnessLoads: FitnessLoad[];
  profile: ProfileSettings;
  settings: CalendarSettings;
  training: TrainingPlan | null;
};

export const loadSettingsSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsSnapshot> => {
    const { loadSettingsSnapshotImpl } = await import("./app-settings.server.ts");
    return loadSettingsSnapshotImpl();
  },
);

export const saveAppSettings = createServerFn({ method: "POST" })
  .validator(appSettingsSaveSchema)
  .handler(async ({ data }): Promise<SavedAppSettings> => {
    const { saveAppSettingsImpl } = await import("./app-settings.server.ts");
    return saveAppSettingsImpl(data);
  });

/** Collects the birthday from athletes who onboarded before it was required. */
export const saveBirthDate = createServerFn({ method: "POST" })
  .validator(profileSaveSchema)
  .handler(async ({ data }): Promise<void> => {
    const { saveBirthDateImpl } = await import("./app-settings.server.ts");
    await saveBirthDateImpl(data);
  });
