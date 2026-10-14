import { createServerFn } from "@tanstack/react-start";

import {
  calendarSettingsSchema,
  type CalendarSettings,
} from "./calendar-settings.types.ts";

export type { CalendarSettings } from "./calendar-settings.types.ts";
export {
  ACTIVITY_COLOR_OPTIONS,
  DEFAULT_CALENDAR_SETTINGS,
  familyCollectors,
  formatSportType,
  heartRateCollectorLabel,
  mergeCalendarSettings,
  sortSportTypeKeys,
  sportOffersPower,
} from "./calendar-settings.types.ts";

export const saveCalendarSettings = createServerFn({ method: "POST" })
  .validator(calendarSettingsSchema)
  .handler(async ({ data }): Promise<CalendarSettings> => {
    const { saveCalendarSettingsImpl } = await import("./calendar-settings.server.ts");
    return saveCalendarSettingsImpl(data);
  });
