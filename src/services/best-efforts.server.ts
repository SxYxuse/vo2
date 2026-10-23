import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activityStreams } from "@/db/schema.ts";
import {
  buildBestEfforts,
  hasBestEfforts,
  isBestEfforts,
  type BestEfforts,
} from "./best-efforts.ts";

const STREAM_BATCH = 40;

type BestEffortsRow = {
  id: string;
  sportType: string;
  deviceWatts: boolean;
  streamId: string | null;
  bestEfforts: unknown;
};

/**
 * Each row's cached best efforts, building and storing the ones that are missing or from an
 * older version. Rows without streams, or of a sport with no bests, are left out.
 */
export async function ensureBestEfforts(rows: BestEffortsRow[]) {
  const result = new Map<string, BestEfforts>();
  const missing: BestEffortsRow[] = [];
  for (const row of rows) {
    if (!row.streamId || !hasBestEfforts(row)) continue;
    if (isBestEfforts(row.bestEfforts)) result.set(row.id, row.bestEfforts);
    else missing.push(row);
  }

  const rowById = new Map(missing.map((row) => [row.id, row]));
  for (let index = 0; index < missing.length; index += STREAM_BATCH) {
    const ids = missing.slice(index, index + STREAM_BATCH).map((row) => row.id);
    const streams = await db
      .select({
        activityId: activityStreams.activityId,
        watts: activityStreams.watts,
        distance: activityStreams.distance,
        time: activityStreams.time,
        altitude: activityStreams.altitude,
      })
      .from(activityStreams)
      .where(inArray(activityStreams.activityId, ids));
    await Promise.all(
      streams.map((stream) => {
        const row = rowById.get(stream.activityId)!;
        const bests = buildBestEfforts({
          ...stream,
          sportType: row.sportType,
          deviceWatts: row.deviceWatts,
        });
        result.set(stream.activityId, bests);
        return db
          .update(activityStreams)
          .set({ bestEfforts: bests })
          .where(eq(activityStreams.activityId, stream.activityId));
      }),
    );
  }
  return { bests: result, built: missing.length };
}
