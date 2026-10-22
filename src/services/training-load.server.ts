import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { ageFromBirthDate } from "./athlete-settings.types.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import {
  activityTrainingLoad,
  estimateLoadAnchors,
  isPowerCyclingSport,
  toFitnessLoad,
  type FitnessLoad,
  type LoadAnchors,
  type LoadInputs,
  type LoadSource,
} from "./training-load.ts";

type StoredLoadRow = LoadInputs & {
  id: string;
  startDate: Date;
  trainingLoad: number | null;
  loadSource: LoadSource | null;
};

async function loadActivityRows(userId: string): Promise<StoredLoadRow[]> {
  const rows = await db
    .select({
      id: activities.id,
      startDate: activities.startDate,
      sportType: activities.sportType,
      movingTime: activities.movingTime,
      distance: activities.distance,
      averageHeartrate: activities.averageHeartrate,
      maxHeartrate: activities.maxHeartrate,
      averageWatts: activities.averageWatts,
      weightedAverageWatts: activities.weightedAverageWatts,
      deviceWatts: activities.deviceWatts,
      trainingLoad: activities.trainingLoad,
      loadSource: activities.loadSource,
    })
    .from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(activities.startDate);

  return rows.map((row) => ({
    ...row,
    loadSource: row.loadSource ?? null,
  }));
}

async function attachPowerStreams(rows: StoredLoadRow[]) {
  const missing = rows.filter(
    (row) =>
      isPowerCyclingSport(row.sportType) &&
      row.deviceWatts &&
      (row.weightedAverageWatts == null || row.weightedAverageWatts <= 0),
  );
  if (!missing.length) return rows;

  const ids = missing.map((row) => row.id);
  const streams: Array<{ activityId: string; watts: number[] | null; time: number[] | null }> = [];
  const batchSize = 40;
  for (let index = 0; index < ids.length; index += batchSize) {
    const chunk = ids.slice(index, index + batchSize);
    const batch = await db
      .select({
        activityId: activityStreams.activityId,
        watts: activityStreams.watts,
        time: activityStreams.time,
      })
      .from(activityStreams)
      .where(inArray(activityStreams.activityId, chunk));
    streams.push(...batch);
  }

  const byId = new Map(streams.map((stream) => [stream.activityId, stream]));
  return rows.map((row) => {
    const stream = byId.get(row.id);
    if (!stream) return row;
    return { ...row, wattsStream: stream.watts, timeStream: stream.time };
  });
}

function persistableAnchors(anchors: LoadAnchors) {
  return {
    ftp: anchors.ftp,
    lthr: anchors.cyclingLthr,
    cyclingLthr: anchors.cyclingLthr,
    runLthr: anchors.runLthr,
    swimLthr: anchors.swimLthr,
    restHr: anchors.restHr,
    updatedAt: new Date(),
  };
}

async function writeLoads(
  updates: { id: string; load: number; source: LoadSource; estimatedHeartrate: number | null }[],
) {
  if (!updates.length) return;
  const values = sql.join(
    updates.map(
      (update) =>
        sql`(${update.id}::text, ${update.load}::double precision, ${update.source}::text, ${update.estimatedHeartrate}::real)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE activities AS a
    SET training_load = v.load,
        load_source = v.source,
        estimated_heartrate = v.estimated_heartrate
    FROM (VALUES ${values}) AS v(id, load, source, estimated_heartrate)
    WHERE a.id = v.id
  `);
}

async function refreshTrainingLoads(userId: string) {
  const rows = await loadActivityRows(userId);
  if (!rows.length) return;

  const withStreams = await attachPowerStreams(rows);
  const [profile] = await db
    .select({ birthDate: athleteMetrics.birthDate })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  const anchors = estimateLoadAnchors(withStreams, {
    age: ageFromBirthDate(profile?.birthDate ?? null),
  });
  const stored = persistableAnchors(anchors);
  await db
    .insert(athleteMetrics)
    .values({ userId, ...stored })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: stored,
    });

  const updates = withStreams.map((row) => {
    return { id: row.id, ...activityTrainingLoad(row, anchors, withStreams) };
  });
  await writeLoads(updates);
  logger.info("training_load.refreshed", {
    activityCount: updates.length,
    ftp: anchors.ftp,
    cyclingLthr: anchors.cyclingLthr,
    runLthr: anchors.runLthr,
    swimLthr: anchors.swimLthr,
    restHr: anchors.restHr,
  });
}

export async function refreshTrainingLoadsForUser(userId: string) {
  await refreshTrainingLoads(userId);
}

export async function loadFitnessDataImpl(): Promise<{
  signedIn: boolean;
  fitnessLoads: FitnessLoad[];
}> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("fitness.anonymous");
    return { signedIn: false, fitnessLoads: [] };
  }

  await refreshTrainingLoadsIfNeeded(session.user.id);

  const rows = await db
    .select({
      startDate: activities.startDate,
      movingTime: activities.movingTime,
      trainingLoad: activities.trainingLoad,
      loadSource: activities.loadSource,
    })
    .from(activities)
    .where(eq(activities.userId, session.user.id))
    .orderBy(activities.startDate);

  logger.debug("fitness.loaded", { activityCount: rows.length });
  return {
    signedIn: true,
    fitnessLoads: rows.map((row) =>
      toFitnessLoad(
        row.startDate,
        row.trainingLoad ?? 0,
        row.loadSource ?? "duration",
        row.movingTime,
      ),
    ),
  };
}

export async function refreshTrainingLoadsIfNeeded(userId: string) {
  const pending = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.userId, userId), isNull(activities.trainingLoad)))
    .limit(1);
  if (pending.length > 0) {
    logger.debug("training_load.refresh_needed");
    await refreshTrainingLoads(userId);
    return;
  }
  const [metrics] = await db
    .select({ restHr: athleteMetrics.restHr })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  if (metrics?.restHr == null) {
    logger.debug("training_load.anchors_refresh_needed");
    await refreshTrainingLoads(userId);
  }
}
