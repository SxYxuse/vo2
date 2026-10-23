import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { isSportTypeShown } from "./athlete-settings.types.ts";
import { ensureBestEfforts } from "./best-efforts.server.ts";
import {
  POWER_DURATIONS,
  RIDE_DISTANCES,
  RUN_DISTANCES,
  SWIM_DISTANCES,
  isOutdoorRideSport,
  isSwimSport,
  type BestEfforts,
} from "./best-efforts.ts";
import {
  boardId,
  type BestsActivity,
  type BestsData,
  type BestsSport,
  type Board,
  type BoardKind,
  type Effort,
} from "./personal-bests.ts";

/** Every sport type any board reads; the rest of the local copy is never loaded here. */
const BESTS_SPORT_TYPES = [
  "Run",
  "TrailRun",
  "Ride",
  "GravelRide",
  "MountainBikeRide",
  "VirtualRide",
  "Velomobile",
  "Handcycle",
  "Swim",
  "OpenWaterSwim",
];

type Row = {
  id: string;
  name: string;
  sportType: string;
  startDate: Date;
  distance: number | null;
  totalElevationGain: number | null;
};

/** Which tab's biggest days an activity counts toward: trail runs yes, virtual rides no. */
function daysSport(sportType: string): BestsSport | null {
  if (sportType === "Run" || sportType === "TrailRun") return "running";
  if (isOutdoorRideSport(sportType)) return "cycling";
  if (isSwimSport(sportType)) return "swimming";
  return null;
}

export async function loadBestsImpl(): Promise<BestsData> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, weightKg: null, activities: [], boards: [] };
  const userId = session.user.id;

  const [rows, settings, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        deviceWatts: activities.deviceWatts,
        streamId: activityStreams.activityId,
        bestEfforts: activityStreams.bestEfforts,
      })
      .from(activities)
      .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(and(eq(activities.userId, userId), inArray(activities.sportType, BESTS_SPORT_TYPES)))
      .orderBy(activities.startDate),
    getAthleteSettings(userId),
    db
      .select({ weightKg: athleteMetrics.weightKg })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
  ]);

  const shown = rows.filter((row) => isSportTypeShown(settings.sportTypes, row.sportType));
  const { bests, built } = await ensureBestEfforts(shown);

  const boards = new Map<string, Board>();
  const board = (sport: BestsSport, kind: BoardKind, key = 0) => {
    const id = boardId(sport, kind, key);
    let found = boards.get(id);
    if (!found) {
      found = { id, sport, kind, key, efforts: [] };
      boards.set(id, found);
    }
    return found;
  };
  // Every distance and duration gets a board up front, so a missing one shows as "not yet".
  for (const metres of RUN_DISTANCES) board("running", "time", metres);
  for (const metres of RIDE_DISTANCES) board("cycling", "time", metres);
  for (const metres of SWIM_DISTANCES) board("swimming", "time", metres);
  for (const seconds of POWER_DURATIONS) board("cycling", "power", seconds);

  const listed: BestsActivity[] = [];
  const indexOf = new Map<string, number>();
  const add = (row: Row, target: Board, effort: Omit<Effort, "activity">) => {
    let index = indexOf.get(row.id);
    if (index == null) {
      index = listed.length;
      indexOf.set(row.id, index);
      listed.push({
        id: row.id,
        name: row.name,
        start: row.startDate.toISOString(),
        sportType: row.sportType,
      });
    }
    target.efforts.push({ ...effort, activity: index });
  };

  for (const row of shown) {
    const cached: BestEfforts | undefined = bests.get(row.id);
    const days = daysSport(row.sportType);
    if (cached) {
      for (const best of cached.power) {
        add(row, board("cycling", "power", best.seconds), { value: best.watts });
      }
      for (const [sport, list] of [
        ["running", cached.run],
        ["cycling", cached.ride],
        ["swimming", cached.swim],
      ] as const) {
        for (const best of list)
          add(row, board(sport, "time", best.metres), { value: best.seconds });
      }
      if (days && cached.climb) {
        add(row, board(days, "climb"), {
          value: cached.climb.gainM,
          distanceM: cached.climb.distanceM,
          gradePct: cached.climb.avgGradePct,
        });
      }
    }
    if (!days) continue;
    if (row.distance && row.distance > 0) add(row, board(days, "longest"), { value: row.distance });
    if (days !== "swimming" && row.totalElevationGain && row.totalElevationGain > 0) {
      add(row, board(days, "climbing"), { value: row.totalElevationGain });
    }
  }

  logger.debug("bests.loaded", { activityCount: shown.length, bestEffortsBuilt: built });
  return {
    signedIn: true,
    weightKg: metricsRows[0]?.weightKg ?? null,
    activities: listed,
    boards: [...boards.values()],
  };
}
