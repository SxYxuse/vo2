import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { DEFAULT_ATHLETE_SETTINGS, isSportTypeShown } from "./athlete-settings.types.ts";
import type { CalendarActivity, HomeData } from "./home-data.types.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";

function toCalendarActivity(
  row: {
    id: string;
    name: string;
    sportType: string;
    startDate: Date;
    elapsedTime: number;
    movingTime: number;
    distance: number | null;
    hasHeartrate: boolean;
  },
  hasStreams: boolean,
): CalendarActivity {
  return {
    id: row.id,
    title: row.name,
    start: row.startDate.toISOString(),
    end: new Date(row.startDate.getTime() + row.elapsedTime * 1000).toISOString(),
    sportType: row.sportType,
    distance: row.distance,
    movingTime: row.movingTime,
    hasStreams,
    hasHeartrate: row.hasHeartrate,
  };
}

export async function loadHomeDataImpl(): Promise<HomeData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("home.anonymous");
    return {
      signedIn: false,
      activities: [],
      settings: DEFAULT_ATHLETE_SETTINGS,
      training: null,
    };
  }

  const [rows, settings, training, streamedWithoutFlag] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        elapsedTime: activities.elapsedTime,
        movingTime: activities.movingTime,
        distance: activities.distance,
        streamsSyncedAt: activities.streamsSyncedAt,
        hasHeartrate: activities.hasHeartrate,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id))
      .orderBy(activities.startDate),
    getAthleteSettings(session.user.id),
    getTrainingPlanForUser(session.user.id),
    db
      .select({ activityId: activityStreams.activityId })
      .from(activities)
      .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(and(eq(activities.userId, session.user.id), isNull(activities.streamsSyncedAt))),
  ]);

  const hasStoredStreams = new Set(streamedWithoutFlag.map((row) => row.activityId));
  const calendarActivities: CalendarActivity[] = [];
  let streamsPending = 0;
  for (const row of rows) {
    const hasStreams = Boolean(row.streamsSyncedAt) || hasStoredStreams.has(row.id);
    if (!hasStreams) streamsPending += 1;
    if (!isSportTypeShown(settings.sportTypes, row.sportType)) continue;
    calendarActivities.push(toCalendarActivity(row, hasStreams));
  }

  logger.debug("home.loaded", {
    activityCount: calendarActivities.length,
    streamsPending,
  });

  return {
    signedIn: true,
    activities: calendarActivities,
    training,
    settings,
  };
}
