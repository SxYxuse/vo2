import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { activities, athleteMetrics } from "#/db/schema.ts";
import {
  activityTrainingLoad,
  estimateFtp,
  estimateLthr,
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

async function writeLoads(
  updates: { id: string; load: number; source: LoadSource }[],
) {
  if (!updates.length) return;
  const values = sql.join(
    updates.map(
      (update) => sql`(${update.id}::text, ${update.load}::double precision, ${update.source}::text)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE activities AS a
    SET training_load = v.load,
        load_source = v.source
    FROM (VALUES ${values}) AS v(id, load, source)
    WHERE a.id = v.id
  `);
}

async function refreshTrainingLoads(userId: string) {
  const rows = await loadActivityRows(userId);
  if (!rows.length) return;

  const ftp = estimateFtp(rows);
  const lthr = estimateLthr(rows);
  await db
    .insert(athleteMetrics)
    .values({ userId, ftp, lthr, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: { ftp, lthr, updatedAt: new Date() },
    });

  const updates = rows.map((row) => {
    const { load, source } = activityTrainingLoad(row, ftp, lthr);
    return { id: row.id, load, source };
  });
  await writeLoads(updates);
}

export async function refreshTrainingLoadsForUser(userId: string) {
  await refreshTrainingLoads(userId);
}

export async function refreshTrainingLoadsIfNeeded(userId: string) {
  const pending = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.userId, userId), isNull(activities.trainingLoad)))
    .limit(1);
  if (pending.length > 0) {
    await refreshTrainingLoads(userId);
  }
}
