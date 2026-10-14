import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { activities } from "#/db/schema.ts";
import { getOptionalSession } from "#/lib/session.server.ts";
import type { ActivityMapData } from "./activity-map.types.ts";

export async function loadActivityMapImpl(): Promise<ActivityMapData> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, tracks: [] };

  const rows = await db
    .select({
      id: activities.id,
      title: activities.name,
      sportType: activities.sportType,
      polyline: activities.summaryPolyline,
    })
    .from(activities)
    .where(and(eq(activities.userId, session.user.id), isNotNull(activities.summaryPolyline)));

  return {
    signedIn: true,
    tracks: rows.flatMap((row) => {
      if (!row.polyline) return [];
      return [{ id: row.id, title: row.title, sportType: row.sportType, polyline: row.polyline }];
    }),
  };
}
