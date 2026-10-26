import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { ageFromBirthDate, familyCollectors } from "./athlete-settings.types.ts";
import { estimateMaxHrAnchor, histogramFromStreams, type HeartPeak } from "./heart-insights.ts";
import {
  athleteMaxHr,
  heartRateFamily,
  isPlausibleBpm,
  sportHeartRate,
  zonesFromHistogram,
  type HeartRateFamily,
  type ZoneAnchors,
} from "./heart-rate.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import { goalsFor } from "./season.server.ts";
import type { Goal } from "./season.types.ts";
import {
  goalSessions,
  recentPaces,
  seasonPhase,
  type GroupPace,
  type SeasonPhase,
} from "./season-phase.ts";
import type { SportGroupId } from "./sport-groups.ts";
import { buildPmc, toFitnessLoad } from "./training-load.ts";
import { refreshTrainingLoadsIfNeeded } from "./training-load.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import {
  addDayKey,
  dayKey,
  sportFamilyOf,
  weekStartKey,
  type TrainingPlan,
} from "./training-plan.types.ts";
import { goalsNear, planWeeksAhead, type WeekAhead } from "./week-plan.ts";
import {
  HISTORY_WEEKS,
  estimatedHardMinutes,
  type DayTotal,
  type WeekActivity,
  type WeekTargetData,
} from "./week-target.ts";

const NO_COLLECTORS = { heartRate: false, power: false, powerPartial: false };
const NO_ZONES: ZoneAnchors = { maxHr: null, lthr: null };
const NO_ANCHORS = {
  ftpWatts: null,
  heartRate: {
    cycling: NO_ZONES,
    running: NO_ZONES,
    swimming: NO_ZONES,
    walking: NO_ZONES,
  },
};

/** Weeks after this one the week page previews. */
const WEEKS_AHEAD = 2;

/** This week, and the weeks after it as the plan would lay them out today. */
export type WeekPageData = WeekTargetData & { ahead: WeekAhead[] };

function emptyWeek(signedIn: boolean, timeZone: string): WeekPageData {
  const now = new Date();
  return {
    signedIn,
    plan: null,
    today: dayKey(now, timeZone),
    weekStart: weekStartKey(now, timeZone),
    activities: [],
    history: [],
    weekStartFitness: { ctl: 0, atl: 0 },
    fitness: { ctl: 0, atl: 0 },
    collectors: {
      running: NO_COLLECTORS,
      cycling: NO_COLLECTORS,
      swimming: NO_COLLECTORS,
      walking: NO_COLLECTORS,
    },
    anchors: NO_ANCHORS,
    season: seasonPhase([], weekStartKey(now, timeZone)),
    nearbyGoals: [],
    ahead: [],
  };
}

/** The goals the plan reads: its own copy once built (ADR 0026), the season's before that. */
export function planGoals(plan: { goals: Goal[] | unknown[] | null }, season: Goal[]): Goal[] {
  return (plan.goals as Goal[] | null) ?? season;
}

/** Minutes in each heart-rate zone from the stream, using that sport's zones. */
function zoneMinutesFromStream(
  heartrate: number[] | null,
  time: number[] | null,
  sportType: string,
  anchors: ZoneAnchors,
) {
  if (!heartrate?.length) return null;
  const histogram = histogramFromStreams(heartrate, time);
  const zones = zonesFromHistogram(histogram, sportType, anchors);
  if (!zones.length || zones.every((zone) => zone.minBpm == null)) return null;
  return zones.map((zone) => Math.round(zone.seconds / 60));
}

function withGoalSessions(
  phase: SeasonPhase,
  paces: Partial<Record<SportGroupId, GroupPace>>,
): SeasonPhase {
  return { ...phase, sessions: goalSessions(phase, paces) };
}

/** This week for the signed-in athlete, on their saved plan or on `draft` for a preview. */
export async function loadWeekTargetImpl(draft?: TrainingPlan): Promise<WeekPageData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("week_target.anonymous");
    return emptyWeek(false, "UTC");
  }
  const userId = session.user.id;
  const plan = draft ?? (await getTrainingPlanForUser(userId));
  if (!plan) return emptyWeek(true, "UTC");
  const timeZone = plan.timeZone;

  await refreshTrainingLoadsIfNeeded(userId);
  const now = new Date();
  const today = dayKey(now, timeZone);
  const weekStart = weekStartKey(now, timeZone);
  const weekEnd = addDayKey(weekStart, 6);
  const historyStart = addDayKey(weekStart, -7 * HISTORY_WEEKS);

  const [rows, settings, metricsRows, seasonGoals] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        trainingLoad: activities.trainingLoad,
        loadSource: activities.loadSource,
        hasHeartrate: activities.hasHeartrate,
        maxHeartrate: activities.maxHeartrate,
        averageHeartrate: activities.averageHeartrate,
      })
      .from(activities)
      .where(eq(activities.userId, userId)),
    getAthleteSettings(userId),
    db
      .select({
        ...HEART_RATE_METRICS,
        ftp: athleteMetrics.ftp,
        birthDate: athleteMetrics.birthDate,
      })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
    goalsFor(userId),
  ]);

  const pmc = buildPmc(
    rows.map((row) =>
      toFitnessLoad(
        row.startDate,
        row.trainingLoad ?? 0,
        row.loadSource ?? "duration",
        row.movingTime,
      ),
    ),
    timeZone,
  );
  const latest = pmc.at(-1);
  const beforeWeek = [...pmc].reverse().find((point) => point.date < weekStart);

  const peaks = new Map<HeartRateFamily, HeartPeak[]>();
  const history = new Map<string, DayTotal>();
  const week: Array<(typeof rows)[number] & { date: string }> = [];
  for (const row of rows) {
    if (isPlausibleBpm(row.maxHeartrate)) {
      const family = heartRateFamily(row.sportType);
      const list = peaks.get(family) ?? [];
      list.push({
        bpm: row.maxHeartrate!,
        start: row.startDate.toISOString(),
        avgBpm: row.averageHeartrate,
      });
      peaks.set(family, list);
    }
    const date = dayKey(row.startDate, timeZone);
    if (date >= weekStart && date <= weekEnd) {
      week.push({ ...row, date });
      continue;
    }
    if (date < historyStart || date >= weekStart) continue;
    const family = sportFamilyOf(row.sportType);
    const key = `${date}:${family}`;
    const total = history.get(key) ?? { date, family, minutes: 0, load: 0 };
    total.minutes += Math.round(row.movingTime / 60);
    total.load += row.trainingLoad ?? 0;
    history.set(key, total);
  }

  const metrics = metricsRows[0];
  const age = ageFromBirthDate(metrics?.birthDate ?? null);
  const athlete = athleteHeartRateFrom(metrics);
  const zoneAnchors = new Map<HeartRateFamily, ZoneAnchors>();
  const anchorsFor = (family: HeartRateFamily) => {
    const cached = zoneAnchors.get(family);
    if (cached) return cached;
    const maxHr = estimateMaxHrAnchor(peaks.get(family) ?? [], {
      family,
      age,
      athleteBpm: athleteMaxHr(family, athlete),
    }).bpm;
    const anchors = sportHeartRate(family, maxHr, athlete);
    zoneAnchors.set(family, anchors);
    return anchors;
  };

  const streamIds = week.filter((row) => row.hasHeartrate).map((row) => row.id);
  const streams = streamIds.length
    ? await db
        .select({
          activityId: activityStreams.activityId,
          heartrate: activityStreams.heartrate,
          time: activityStreams.time,
        })
        .from(activityStreams)
        .where(inArray(activityStreams.activityId, streamIds))
    : [];
  const streamById = new Map(streams.map((stream) => [stream.activityId, stream]));

  const weekActivities: WeekActivity[] = week
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
    .map((row) => {
      const minutes = Math.round(row.movingTime / 60);
      const load = row.trainingLoad ?? 0;
      const family = heartRateFamily(row.sportType);
      const stream = streamById.get(row.id);
      const zoneMinutes = stream
        ? zoneMinutesFromStream(
            stream.heartrate ?? null,
            stream.time ?? null,
            row.sportType,
            anchorsFor(family),
          )
        : null;
      return {
        id: row.id,
        title: row.name,
        date: row.date,
        sportType: row.sportType,
        family: sportFamilyOf(row.sportType),
        minutes,
        load,
        hardMinutes:
          zoneMinutes == null
            ? estimatedHardMinutes(minutes, load)
            : Math.min(minutes, zoneMinutes[2] + zoneMinutes[3] + zoneMinutes[4]),
        hardSource: zoneMinutes == null ? ("estimate" as const) : ("heartRate" as const),
        zoneMinutes,
      };
    });

  const { sportTypes } = settings;
  const goals = planGoals(plan, seasonGoals);
  const paces = recentPaces(rows, now);
  logger.debug("week_target.loaded", {
    weekStart,
    activityCount: weekActivities.length,
    streamCount: streams.length,
  });

  const data: WeekTargetData & { plan: TrainingPlan } = {
    signedIn: true,
    plan,
    today,
    weekStart,
    season: withGoalSessions(seasonPhase(goals, weekStart), paces),
    nearbyGoals: goalsNear(goals, weekStart),
    activities: weekActivities,
    history: [...history.values()],
    weekStartFitness: beforeWeek
      ? { ctl: beforeWeek.ctl, atl: beforeWeek.atl }
      : { ctl: 0, atl: 0 },
    fitness: latest ? { ctl: latest.ctl, atl: latest.atl } : { ctl: 0, atl: 0 },
    collectors: {
      running: familyCollectors(sportTypes, "running"),
      cycling: familyCollectors(sportTypes, "cycling"),
      swimming: familyCollectors(sportTypes, "swimming"),
      walking: familyCollectors(sportTypes, "walking"),
    },
    anchors: {
      ftpWatts: metrics?.ftp ?? null,
      heartRate: {
        cycling: anchorsFor("cycling"),
        running: anchorsFor("running"),
        swimming: anchorsFor("swimming"),
        walking: anchorsFor("walking"),
      },
    },
  };
  // A draft only previews this week; the weeks ahead are for the week page.
  return { ...data, ahead: draft ? [] : planWeeksAhead(data, goals, paces, WEEKS_AHEAD) };
}
