import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { calendarSettings } from "@/db/schema.ts";
import { parseCalendarSettings, type CalendarSettings } from "./calendar-settings.types.ts";

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
