import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { calendarSettings } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import {
  calendarSettingsSchema,
  parseCalendarSettings,
  type CalendarSettings,
} from "./calendar-settings.types.ts";

export const getCalendarSettingsForUser = cache(
  async (userId: string): Promise<CalendarSettings | null> => {
    const [row] = await db
      .select({ value: calendarSettings.value })
      .from(calendarSettings)
      .where(eq(calendarSettings.userId, userId))
      .limit(1);
    return row ? parseCalendarSettings(row.value) : null;
  },
);

export async function saveCalendarSettingsImpl(value: CalendarSettings): Promise<CalendarSettings> {
  const session = await getRequiredSession();
  const settings = parseCalendarSettings(calendarSettingsSchema.parse(value));
  if (!settings) {
    throw new Error("Invalid calendar settings");
  }

  await db
    .insert(calendarSettings)
    .values({
      userId: session.user.id,
      value: settings,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: calendarSettings.userId,
      set: {
        value: settings,
        updatedAt: new Date(),
      },
    });

  logger.info("calendar_settings.saved", {
    weekStartsOn: settings.weekStartsOn,
    sportTypeCount: Object.keys(settings.sportTypes).length,
  });
  return settings;
}
