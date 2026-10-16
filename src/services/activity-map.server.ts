import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { DEFAULT_CALENDAR_SETTINGS, mergeCalendarSettings } from "./calendar-settings.types.ts";
import type { ActivityMapData } from "./activity-map.types.ts";

const EMPTY_MAP: ActivityMapData = {
  signedIn: false,
  tracks: [],
  sportTypes: DEFAULT_CALENDAR_SETTINGS.sportTypes,
  sportGroupShares: DEFAULT_CALENDAR_SETTINGS.sportGroupShares,
};

export async function loadActivityMapImpl(): Promise<ActivityMapData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("map.anonymous");
    return EMPTY_MAP;
  }

  const [rows, storedSettings] = await Promise.all([
    db
      .select({
        id: activities.id,
        title: activities.name,
        sportType: activities.sportType,
        polyline: activities.summaryPolyline,
      })
      .from(activities)
      .where(and(eq(activities.userId, session.user.id), isNotNull(activities.summaryPolyline))),
    getCalendarSettingsForUser(session.user.id),
  ]);

  const settings = mergeCalendarSettings(
    storedSettings,
    rows.map((row) => row.sportType),
  );

  const tracks = rows.flatMap((row) => {
    if (!row.polyline) return [];
    return [{ id: row.id, title: row.title, sportType: row.sportType, polyline: row.polyline }];
  });
  logger.debug("map.loaded", { trackCount: tracks.length });

  return {
    signedIn: true,
    tracks,
    sportTypes: settings.sportTypes,
    sportGroupShares: settings.sportGroupShares,
  };
}
