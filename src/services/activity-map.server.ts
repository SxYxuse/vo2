import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { DEFAULT_ATHLETE_SETTINGS, isSportTypeShown } from "./athlete-settings.types.ts";
import type { ActivityMapData } from "./activity-map.types.ts";

const EMPTY_MAP: ActivityMapData = {
  signedIn: false,
  tracks: [],
  sportTypes: DEFAULT_ATHLETE_SETTINGS.sportTypes,
  sportGroupShares: DEFAULT_ATHLETE_SETTINGS.sportGroupShares,
};

export async function loadActivityMapImpl(): Promise<ActivityMapData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("map.anonymous");
    return EMPTY_MAP;
  }

  const [rows, settings] = await Promise.all([
    db
      .select({
        id: activities.id,
        title: activities.name,
        sportType: activities.sportType,
        polyline: activities.summaryPolyline,
      })
      .from(activities)
      .where(and(eq(activities.userId, session.user.id), isNotNull(activities.summaryPolyline))),
    getAthleteSettings(session.user.id),
  ]);

  const tracks = rows.flatMap((row) => {
    if (!row.polyline || !isSportTypeShown(settings.sportTypes, row.sportType)) return [];
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
