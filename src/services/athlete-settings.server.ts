import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, athleteMetrics, athleteSettings } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import {
  ageFromBirthDate,
  DEFAULT_ATHLETE_SETTINGS,
  DEFAULT_PROFILE_SETTINGS,
  mergeAthleteSettings,
  parseAthleteSettings,
  type AthleteSettings,
  type ProfileSave,
  type ProfileSettings,
} from "./athlete-settings.types.ts";
import type {
  AthleteSettingsSave,
  SavedAthleteSettings,
  SettingsSnapshot,
} from "./athlete-settings.ts";
import { estimateMaxHrAnchor, type HeartPeak } from "./heart-insights.ts";
import { heartRateFamily, isPlausibleBpm, isZonedFamily, type ZonedFamily } from "./heart-rate.ts";
import {
  DEFAULT_HEART_RATE_SETTINGS,
  heartRateSettingsIssues,
  parseHeartRateSettings,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "./heart-rate-settings.ts";
import { toFitnessLoad } from "./training-load.ts";
import { refreshTrainingLoadsForUser } from "./training-load.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";

async function storedAthleteSettings(userId: string) {
  const [row] = await db
    .select({ value: athleteSettings.value })
    .from(athleteSettings)
    .where(eq(athleteSettings.userId, userId))
    .limit(1);
  return row ? parseAthleteSettings(row.value) : null;
}

async function copiedSportTypes(userId: string) {
  const rows = await db
    .selectDistinct({ sportType: activities.sportType })
    .from(activities)
    .where(eq(activities.userId, userId));
  return rows.map((row) => row.sportType);
}

/** Settings with an entry for every sport type in the athlete's local copy. */
export async function getAthleteSettings(userId: string): Promise<AthleteSettings> {
  const [stored, sportTypes] = await Promise.all([
    storedAthleteSettings(userId),
    copiedSportTypes(userId),
  ]);
  return mergeAthleteSettings(stored, sportTypes);
}

const NO_ESTIMATES: HeartRateEstimates = {
  restHr: null,
  maxHr: { cycling: null, running: null, swimming: null },
};

async function getHeartRateSettings(userId: string): Promise<HeartRateSettings> {
  const [row] = await db
    .select({ heartRate: athleteMetrics.heartRate })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  return parseHeartRateSettings(row?.heartRate);
}

/** What VO2 would use with nothing set: the same max-HR rule as every view, without overrides. */
async function heartRateEstimates(userId: string): Promise<HeartRateEstimates> {
  const [rows, [metrics]] = await Promise.all([
    db
      .select({
        sportType: activities.sportType,
        startDate: activities.startDate,
        maxHeartrate: activities.maxHeartrate,
        averageHeartrate: activities.averageHeartrate,
      })
      .from(activities)
      .where(eq(activities.userId, userId)),
    db
      .select({ restHr: athleteMetrics.restHr, birthDate: athleteMetrics.birthDate })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
  ]);
  const peaks: Record<ZonedFamily, HeartPeak[]> = { cycling: [], running: [], swimming: [] };
  for (const row of rows) {
    const family = heartRateFamily(row.sportType);
    if (!isZonedFamily(family) || !isPlausibleBpm(row.maxHeartrate)) continue;
    peaks[family].push({
      bpm: row.maxHeartrate!,
      start: row.startDate.toISOString(),
      avgBpm: row.averageHeartrate,
    });
  }
  const age = ageFromBirthDate(metrics?.birthDate ?? null);
  const maxHr = (family: ZonedFamily) => {
    const anchor = estimateMaxHrAnchor(peaks[family], { family, age });
    return anchor.peak ? anchor.bpm : null;
  };
  return {
    restHr: metrics?.restHr ?? null,
    maxHr: { cycling: maxHr("cycling"), running: maxHr("running"), swimming: maxHr("swimming") },
  };
}

export async function getAthleteProfile(userId: string): Promise<ProfileSettings> {
  const [row] = await db
    .select({
      birthDate: athleteMetrics.birthDate,
      weightKg: athleteMetrics.weightKg,
    })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_PROFILE_SETTINGS;
  return { birthDate: row.birthDate ?? null, weightKg: row.weightKg ?? null };
}

export async function loadSettingsSnapshotImpl(): Promise<SettingsSnapshot> {
  const session = await getOptionalSession();
  if (!session) {
    return {
      signedIn: false,
      fitnessLoads: [],
      profile: DEFAULT_PROFILE_SETTINGS,
      settings: DEFAULT_ATHLETE_SETTINGS,
      training: null,
      heartRate: DEFAULT_HEART_RATE_SETTINGS,
      heartRateEstimates: NO_ESTIMATES,
    };
  }
  const [profile, settings, training, heartRate, estimates, loadRows] = await Promise.all([
    getAthleteProfile(session.user.id),
    getAthleteSettings(session.user.id),
    getTrainingPlanForUser(session.user.id),
    getHeartRateSettings(session.user.id),
    heartRateEstimates(session.user.id),
    db
      .select({
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        trainingLoad: activities.trainingLoad,
        loadSource: activities.loadSource,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id)),
  ]);
  return {
    signedIn: true,
    profile,
    settings,
    training,
    heartRate,
    heartRateEstimates: estimates,
    fitnessLoads: loadRows.map((row) =>
      toFitnessLoad(
        row.startDate,
        row.trainingLoad ?? 0,
        row.loadSource ?? "duration",
        row.movingTime,
      ),
    ),
  };
}

export async function saveAthleteSettingsImpl(
  value: AthleteSettingsSave,
): Promise<SavedAthleteSettings> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const [stored, sportTypes, previousProfile, previousHeartRate] = await Promise.all([
    storedAthleteSettings(userId),
    copiedSportTypes(userId),
    getAthleteProfile(userId),
    getHeartRateSettings(userId),
  ]);
  const heartRate = value.heartRate ?? previousHeartRate;
  const heartRateChanged = JSON.stringify(heartRate) !== JSON.stringify(previousHeartRate);
  if (heartRateChanged) {
    const [issue] = heartRateSettingsIssues(heartRate, await heartRateEstimates(userId));
    if (issue) throw new Error(issue.message);
  }
  const parsed = parseAthleteSettings({
    ...(stored ?? DEFAULT_ATHLETE_SETTINGS),
    sportTypes: { ...stored?.sportTypes, ...value.sportTypes },
    sportGroupShares: value.sportGroupShares,
    calendarPeriod: value.calendarPeriod ?? stored?.calendarPeriod ?? "month",
  });
  if (!parsed) throw new Error("Invalid athlete settings");
  const settings = mergeAthleteSettings(parsed, [...sportTypes, ...Object.keys(value.sportTypes)]);

  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(athleteMetrics)
      .values({
        userId,
        birthDate: value.profile.birthDate,
        weightKg: value.profile.weightKg,
        training: value.training,
        heartRate,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: athleteMetrics.userId,
        set: {
          birthDate: value.profile.birthDate,
          weightKg: value.profile.weightKg,
          ...(value.training ? { training: value.training } : {}),
          heartRate,
          updatedAt,
        },
      });
    await tx
      .insert(athleteSettings)
      .values({ userId, value: settings, updatedAt })
      .onConflictDoUpdate({
        target: athleteSettings.userId,
        set: { value: settings, updatedAt },
      });
  });

  // Age caps the max-HR anchor, which sets LTHR and so heart-rate training load; set anchors
  // score it directly. Either way every past activity is rescored (ADR 0021).
  if (previousProfile.birthDate !== value.profile.birthDate || heartRateChanged) {
    await refreshTrainingLoadsForUser(userId);
  }

  const training = value.training ?? (await getTrainingPlanForUser(userId));
  logger.info("settings.saved", { hasTraining: Boolean(training) });
  return { profile: value.profile, settings, training, heartRate };
}

export async function saveProfileImpl(value: ProfileSave): Promise<void> {
  const session = await getRequiredSession();
  const previousProfile = await getAthleteProfile(session.user.id);
  const fields = { birthDate: value.birthDate, weightKg: value.weightKg, updatedAt: new Date() };
  await db
    .insert(athleteMetrics)
    .values({ userId: session.user.id, ...fields })
    .onConflictDoUpdate({ target: athleteMetrics.userId, set: fields });
  if (previousProfile.birthDate !== value.birthDate) {
    await refreshTrainingLoadsForUser(session.user.id);
  }
  logger.info("profile.saved");
}
