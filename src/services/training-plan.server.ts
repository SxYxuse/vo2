import { cache } from "react";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { activities, athleteMetrics, fieldTests, plannedSessions } from "#/db/schema.ts";
import { logger } from "#/lib/logger.server.ts";
import { getRequiredSession } from "#/lib/session.server.ts";
import { parseAssessmentResult } from "./assessments-score.ts";
import { familyCollectors } from "./calendar-settings.types.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { toFitnessLoad } from "./training-load.ts";
import {
  assignActivitiesToSessions,
  dayKey,
  isAssessmentSession,
  latestPmc,
  isTrainingPlanComplete,
  parseTrainingPlan,
  planRemainingWeek,
  sportFamilyOf,
  weekStartKey,
  type MatchableActivity,
  type PlannedSession,
  type TestAnchors,
  type TrainingPlan,
} from "./training-plan.types.ts";

export const getTrainingPlanForUser = cache(
  async (userId: string): Promise<TrainingPlan | null> => {
    const [row] = await db
      .select({ training: athleteMetrics.training })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1);
    return parseTrainingPlan(row?.training);
  },
);

export async function saveTrainingPlanForUser(userId: string, plan: TrainingPlan) {
  logger.info("training_plan.saved", {
    targetWeeklyHours: plan.targetWeeklyHours,
    buildPace: plan.buildPace,
    workoutStyle: plan.workoutStyle,
  });
  await db
    .insert(athleteMetrics)
    .values({ userId, training: plan, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: { training: plan, updatedAt: new Date() },
    });
}

function toPlanned(row: {
  id: string;
  date: string;
  weekStart: string;
  sportFamily: "running" | "cycling";
  title: string;
  targetMinutes: number;
  targetLoad: number;
  status: "planned" | "done" | "adapted";
  note: string | null;
  activityId?: string | null;
  activityTitle?: string | null;
}): PlannedSession {
  return {
    ...row,
    activityId: row.activityId ?? null,
    activityTitle: row.activityTitle ?? null,
  };
}

function plannedInsert(userId: string, session: PlannedSession) {
  return {
    id: session.id,
    userId,
    date: session.date,
    weekStart: session.weekStart,
    sportFamily: session.sportFamily,
    title: session.title,
    targetMinutes: session.targetMinutes,
    targetLoad: session.targetLoad,
    status: session.status,
    note: session.note,
    activityId: session.activityId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function listPlannedSessions(userId: string, from: string): Promise<PlannedSession[]> {
  const rows = await db
    .select({
      id: plannedSessions.id,
      date: plannedSessions.date,
      weekStart: plannedSessions.weekStart,
      sportFamily: plannedSessions.sportFamily,
      title: plannedSessions.title,
      targetMinutes: plannedSessions.targetMinutes,
      targetLoad: plannedSessions.targetLoad,
      status: plannedSessions.status,
      note: plannedSessions.note,
      activityId: plannedSessions.activityId,
      activityTitle: activities.name,
    })
    .from(plannedSessions)
    .leftJoin(activities, eq(plannedSessions.activityId, activities.id))
    .where(and(eq(plannedSessions.userId, userId), gte(plannedSessions.date, from)))
    .orderBy(plannedSessions.date);
  return rows.map(toPlanned);
}

async function weekActivitiesForUser(
  userId: string,
  weekStart: string,
  weekEnd: string,
  timeZone: string,
): Promise<MatchableActivity[]> {
  const rows = await db
    .select({
      id: activities.id,
      startDate: activities.startDate,
      sportType: activities.sportType,
      movingTime: activities.movingTime,
      trainingLoad: activities.trainingLoad,
    })
    .from(activities)
    .where(eq(activities.userId, userId));
  const week: MatchableActivity[] = [];
  for (const row of rows) {
    const date = dayKey(row.startDate, timeZone);
    if (date < weekStart || date > weekEnd) continue;
    week.push({
      id: row.id,
      date,
      family: sportFamilyOf(row.sportType),
      minutes: Math.round(row.movingTime / 60),
      load: row.trainingLoad ?? 0,
    });
  }
  return week;
}

async function flaggedActivityIds(userId: string) {
  const rows = await db
    .select({ activityId: fieldTests.activityId })
    .from(fieldTests)
    .where(and(eq(fieldTests.userId, userId), isNotNull(fieldTests.activityId)));
  return new Set(rows.flatMap((row) => (row.activityId ? [row.activityId] : [])));
}

async function fitnessLoadsForUser(userId: string) {
  const rows = await db
    .select({
      startDate: activities.startDate,
      movingTime: activities.movingTime,
      trainingLoad: activities.trainingLoad,
      loadSource: activities.loadSource,
    })
    .from(activities)
    .where(eq(activities.userId, userId));
  return rows.map((row) =>
    toFitnessLoad(
      row.startDate,
      row.trainingLoad ?? 0,
      row.loadSource ?? "duration",
      row.movingTime,
    ),
  );
}

function plannedFromCutoff() {
  return new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
}

export async function suggestWeekImpl(timeZone: string): Promise<PlannedSession[]> {
  const session = await getRequiredSession();
  logger.info("training_plan.suggest", { timeZone });
  const plan = await getTrainingPlanForUser(session.user.id);
  if (!isTrainingPlanComplete(plan)) {
    logger.warn("training_plan.suggest_incomplete");
    throw new Error("Set your training goal in Settings first.");
  }
  const nextPlan = plan.timeZone === timeZone ? plan : { ...plan, timeZone };
  if (nextPlan !== plan) {
    await saveTrainingPlanForUser(session.user.id, nextPlan);
  }
  await rebuildWeek(session.user.id, timeZone, new Date(), "suggest", nextPlan);
  return listPlannedSessions(session.user.id, plannedFromCutoff());
}

export async function adaptPlannedWeek(userId: string) {
  const plan = await getTrainingPlanForUser(userId);
  if (!plan) return;
  const existing = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(eq(plannedSessions.userId, userId))
    .limit(1);
  if (!existing.length) return;
  logger.info("training_plan.adapt");
  await rebuildWeek(userId, plan.timeZone, new Date(), "adapt", plan);
}

async function rebuildWeek(
  userId: string,
  timeZone: string,
  now: Date,
  mode: "suggest" | "adapt",
  plan: TrainingPlan,
): Promise<PlannedSession[]> {
  const today = dayKey(now, timeZone);
  const weekStart = weekStartKey(now, timeZone);
  const weekEnd = addDate(weekStart, 6);
  const [loads, flagged, weekActivities, existing, settings, anchors] = await Promise.all([
    fitnessLoadsForUser(userId),
    flaggedActivityIds(userId),
    weekActivitiesForUser(userId, weekStart, weekEnd, timeZone),
    db
      .select({
        id: plannedSessions.id,
        date: plannedSessions.date,
        weekStart: plannedSessions.weekStart,
        sportFamily: plannedSessions.sportFamily,
        title: plannedSessions.title,
        targetMinutes: plannedSessions.targetMinutes,
        targetLoad: plannedSessions.targetLoad,
        status: plannedSessions.status,
        note: plannedSessions.note,
        activityId: plannedSessions.activityId,
      })
      .from(plannedSessions)
      .where(and(eq(plannedSessions.userId, userId), eq(plannedSessions.weekStart, weekStart))),
    getCalendarSettingsForUser(userId),
    mode === "suggest"
      ? latestTestAnchors(userId)
      : Promise.resolve({
          ftpWatts: null,
          cyclingLthr: null,
          cyclingMaxHr: null,
          runLthr: null,
          runMaxHr: null,
        } satisfies TestAnchors),
  ]);
  const pmc = latestPmc(loads, timeZone);
  const completed = weekActivities
    .filter((activity) => !flagged.has(activity.id))
    .map((activity) => ({
      date: activity.date,
      family: activity.family,
      minutes: activity.minutes,
      load: activity.load,
    }));

  const existingPlanned = existing.map((row) => toPlanned(row));
  const matches = assignActivitiesToSessions(
    weekActivities.filter((activity) => !flagged.has(activity.id)),
    existingPlanned,
  );
  const matchBySession = new Map(matches.map((match) => [match.sessionId, match]));
  const preserved = existingPlanned
    .filter((session) => {
      if (session.status === "done" || matchBySession.has(session.id)) return true;
      return mode === "adapt" && !isAssessmentSession(session);
    })
    .map((session) => {
      const match = matchBySession.get(session.id);
      if (!match) return session;
      return {
        ...session,
        status: "done" as const,
        activityId: match.activityId,
        date: match.date,
      };
    });

  await db
    .delete(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.weekStart, weekStart),
        lte(plannedSessions.date, weekEnd),
      ),
    );

  const sportTypes = settings?.sportTypes ?? {};
  const drafts =
    mode === "suggest"
      ? planRemainingWeek({
          plan: { ...plan, timeZone },
          today,
          ctl: pmc.ctl,
          tsb: pmc.tsb,
          completed,
          collectors: {
            running: familyCollectors(sportTypes, "running"),
            cycling: familyCollectors(sportTypes, "cycling"),
          },
          anchors,
        })
      : [];

  const nextStatus = mode === "adapt" ? ("adapted" as const) : ("planned" as const);
  const rows = [
    ...preserved.map((session) => plannedInsert(userId, session)),
    ...drafts.map((draft) =>
      plannedInsert(userId, {
        id: crypto.randomUUID(),
        ...draft,
        status: nextStatus,
      }),
    ),
  ];

  if (rows.length) {
    await db.insert(plannedSessions).values(rows);
  }
  logger.info("training_plan.week_rebuilt", {
    mode,
    weekStart,
    sessionCount: rows.length,
  });

  return rows.map((row) =>
    toPlanned({
      id: row.id,
      date: row.date,
      weekStart: row.weekStart,
      sportFamily: row.sportFamily,
      title: row.title,
      targetMinutes: row.targetMinutes,
      targetLoad: row.targetLoad,
      status: row.status,
      note: row.note ?? null,
      activityId: row.activityId ?? null,
    }),
  );
}

async function latestTestAnchors(userId: string): Promise<TestAnchors> {
  const rows = await db
    .select({
      assessmentId: fieldTests.assessmentId,
      result: fieldTests.result,
    })
    .from(fieldTests)
    .where(and(eq(fieldTests.userId, userId), eq(fieldTests.status, "completed")))
    .orderBy(desc(fieldTests.completedAt));

  const anchors: TestAnchors = {
    ftpWatts: null,
    cyclingLthr: null,
    cyclingMaxHr: null,
    runLthr: null,
    runMaxHr: null,
  };
  for (const row of rows) {
    const result = parseAssessmentResult(row.result);
    if (row.assessmentId === "ftp-20") {
      if (anchors.ftpWatts == null) anchors.ftpWatts = result.ftpWatts;
      if (anchors.cyclingLthr == null) anchors.cyclingLthr = result.cyclingLthr;
      if (anchors.cyclingMaxHr == null) anchors.cyclingMaxHr = result.peakHr;
    }
    if (row.assessmentId === "run-lthr" && anchors.runLthr == null) {
      anchors.runLthr = result.runLthr;
    }
    if (row.assessmentId === "beep-test" && anchors.runMaxHr == null) {
      anchors.runMaxHr = result.peakHr;
    }
  }
  return anchors;
}

function addDate(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
