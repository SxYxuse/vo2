import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { calendarSettings } from "#/db/schema.ts";
import { getRequiredSession } from "#/lib/session.server.ts";
import {
  calendarSettingsSchema,
  parseCalendarSettings,
  type CalendarSettings,
} from "./calendar-settings.types.ts";

export async function getCalendarSettingsForUser(userId: string): Promise<CalendarSettings | null> {
  const [row] = await db
    .select({ value: calendarSettings.value })
    .from(calendarSettings)
    .where(eq(calendarSettings.userId, userId))
    .limit(1);
  return row ? parseCalendarSettings(row.value) : null;
}

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

  return settings;
}
