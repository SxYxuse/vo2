import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { familyCollectors } from "./calendar-settings.types.ts";
import { ageFromBirthDate } from "./app-settings.types.ts";
import { estimateMaxHrAnchor, histogramFromStreams, type HeartPeak } from "./heart-insights.ts";
import {
  familyLthr,
  heartRateFamily,
  isPlausibleBpm,
  zonesFromHistogram,
  type HeartRateFamily,
  type SportLthrAnchors,
} from "./heart-rate.ts";
import { buildPmc, toFitnessLoad } from "./training-load.ts";
import { refreshTrainingLoadsIfNeeded } from "./training-load.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import { addDayKey, dayKey, sportFamilyOf, weekStartKey } from "./training-plan.types.ts";
import {
  HISTORY_WEEKS,
  estimatedHardMinutes,
  type DayTotal,
  type WeekActivity,
  type WeekTargetData,
} from "./week-target.ts";

const NO_COLLECTORS = { heartRate: false, power: false, powerPartial: false };
const NO_ANCHORS = {
  ftpWatts: null,
  cyclingLthr: null,
  cyclingMaxHr: null,
  runLthr: null,
  runMaxHr: null,
};

function emptyWeek(signedIn: boolean, timeZone: string): WeekTargetData {
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
    collectors: { running: NO_COLLECTORS, cycling: NO_COLLECTORS },
    anchors: NO_ANCHORS,
  };
}

/** Minutes in each heart-rate zone from the stream, using that sport's zones. */
function zoneMinutesFromStream(
  heartrate: number[] | null,
  time: number[] | null,
  sportType: string,
  maxHeartrate: number | null,
  lthr: number | null,
) {
  if (!heartrate?.length) return null;
  const histogram = histogramFromStreams(heartrate, time);
  const zones = zonesFromHistogram(histogram, sportType, maxHeartrate, lthr);
  if (!zones.length || zones.every((zone) => zone.minBpm == null)) return null;
  return zones.map((zone) => Math.round(zone.seconds / 60));
}

export async function loadWeekTargetImpl(): Promise<WeekTargetData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("week_target.anonymous");
    return emptyWeek(false, "UTC");
  }
  const userId = session.user.id;
  const plan = await getTrainingPlanForUser(userId);
  if (!plan) return emptyWeek(true, "UTC");
  const timeZone = plan.timeZone;

  await refreshTrainingLoadsIfNeeded(userId);
  const now = new Date();
  const today = dayKey(now, timeZone);
  const weekStart = weekStartKey(now, timeZone);
  const weekEnd = addDayKey(weekStart, 6);
  const historyStart = addDayKey(weekStart, -7 * HISTORY_WEEKS);

  const [rows, settings, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        trainingLoad: activities.trainingLoad,
        loadSource: activities.loadSource,
        hasHeartrate: activities.hasHeartrate,
        maxHeartrate: activities.maxHeartrate,
        averageHeartrate: activities.averageHeartrate,
      })
      .from(activities)
      .where(eq(activities.userId, userId)),
    getCalendarSettingsForUser(userId),
    db
      .select({
        ftp: athleteMetrics.ftp,
        cyclingLthr: athleteMetrics.cyclingLthr,
        runLthr: athleteMetrics.runLthr,
        swimLthr: athleteMetrics.swimLthr,
        lthr: athleteMetrics.lthr,
        birthDate: athleteMetrics.birthDate,
      })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
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
  const stored: SportLthrAnchors = {};
  const cyclingLthr = metrics?.cyclingLthr ?? metrics?.lthr ?? null;
  if (cyclingLthr) stored.cycling = { bpm: cyclingLthr, source: "estimated-from-max" };
  if (metrics?.runLthr) stored.running = { bpm: metrics.runLthr, source: "estimated-from-max" };
  if (metrics?.swimLthr) stored.swimming = { bpm: metrics.swimLthr, source: "estimated-from-max" };
  const zoneAnchors = new Map<HeartRateFamily, { maxHr: number | null; lthr: number | null }>();
  const anchorsFor = (family: HeartRateFamily) => {
    const cached = zoneAnchors.get(family);
    if (cached) return cached;
    const maxHr = estimateMaxHrAnchor(peaks.get(family) ?? [], { family, age }).bpm;
    const anchors = { maxHr, lthr: familyLthr(family, maxHr, stored).lthr };
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
            anchorsFor(family).maxHr,
            anchorsFor(family).lthr,
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

  const sportTypes = settings?.sportTypes ?? {};
  logger.debug("week_target.loaded", {
    weekStart,
    activityCount: weekActivities.length,
    streamCount: streams.length,
  });

  return {
    signedIn: true,
    plan,
    today,
    weekStart,
    activities: weekActivities,
    history: [...history.values()],
    weekStartFitness: beforeWeek
      ? { ctl: beforeWeek.ctl, atl: beforeWeek.atl }
      : { ctl: 0, atl: 0 },
    fitness: latest ? { ctl: latest.ctl, atl: latest.atl } : { ctl: 0, atl: 0 },
    collectors: {
      running: familyCollectors(sportTypes, "running"),
      cycling: familyCollectors(sportTypes, "cycling"),
    },
    anchors: {
      ftpWatts: metrics?.ftp ?? null,
      cyclingLthr: anchorsFor("cycling").lthr,
      cyclingMaxHr: anchorsFor("cycling").maxHr,
      runLthr: anchorsFor("running").lthr,
      runMaxHr: anchorsFor("running").maxHr,
    },
  };
}
