import { createServerFn } from "@tanstack/react-start";

import { appSettingsSaveSchema, type ProfileSettings } from "./app-settings.types.ts";
import type { CalendarSettings } from "./calendar-settings.types.ts";
import type { FitnessLoad } from "./training-load.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export type { AppSettingsSave, ProfileSettings } from "./app-settings.types.ts";
export {
  DEFAULT_PROFILE_SETTINGS,
  ageFromBirthDate,
  formatBirthDate,
  parseBirthDate,
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
