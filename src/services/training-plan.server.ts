import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { activities, athleteMetrics, plannedSessions } from "#/db/schema.ts";
import { getRequiredSession } from "#/lib/session.server.ts";
import { familyCollectors } from "./calendar-settings.types.ts";
import { getCalendarSettingsForUser } from "./calendar-settings.server.ts";
import { toFitnessLoad } from "./training-load.ts";
import {
  dayKey,
  latestPmc,
  isTrainingPlanComplete,
  parseTrainingPlan,
  planRemainingWeek,
  sportFamilyOf,
  weekStartKey,
  type CompletedSession,
  type PlannedSession,
  type TrainingPlan,
} from "./training-plan.types.ts";

export async function getTrainingPlanForUser(userId: string): Promise<TrainingPlan | null> {
  const [row] = await db
    .select({ training: athleteMetrics.training })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  return parseTrainingPlan(row?.training);
}

export async function saveTrainingPlanForUser(userId: string, plan: TrainingPlan) {
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
}): PlannedSession {
  return row;
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
    })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.userId, userId), gte(plannedSessions.date, from)))
    .orderBy(plannedSessions.date);
  return rows.map(toPlanned);
}

async function completedFromActivities(
  userId: string,
  weekStart: string,
  weekEnd: string,
  timeZone: string,
) {
  const rows = await db
    .select({
      startDate: activities.startDate,
      sportType: activities.sportType,
      movingTime: activities.movingTime,
      trainingLoad: activities.trainingLoad,
      loadSource: activities.loadSource,
    })
    .from(activities)
    .where(eq(activities.userId, userId));
  const completed: CompletedSession[] = [];
  for (const row of rows) {
    const date = dayKey(row.startDate, timeZone);
    if (date < weekStart || date > weekEnd) continue;
    completed.push({
      date,
      family: sportFamilyOf(row.sportType),
      minutes: Math.round(row.movingTime / 60),
      load: row.trainingLoad ?? 0,
    });
  }
  return completed;
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
    toFitnessLoad(row.startDate, row.trainingLoad ?? 0, row.loadSource ?? "duration", row.movingTime),
  );
}

function plannedFromCutoff() {
  return new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
}

export async function suggestWeekImpl(timeZone: string): Promise<PlannedSession[]> {
  const session = await getRequiredSession();
  const plan = await getTrainingPlanForUser(session.user.id);
  if (!isTrainingPlanComplete(plan)) {
    throw new Error("Set your training goal in Settings first.");
  }
  if (plan.timeZone !== timeZone) {
    await saveTrainingPlanForUser(session.user.id, { ...plan, timeZone });
  }
  await rebuildWeek(session.user.id, timeZone, new Date(), "suggest");
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
  await rebuildWeek(userId, plan.timeZone, new Date(), "adapt");
}

async function rebuildWeek(
  userId: string,
  timeZone: string,
  now: Date,
  mode: "suggest" | "adapt",
): Promise<PlannedSession[]> {
  const plan = await getTrainingPlanForUser(userId);
  if (!plan) return [];
  const today = dayKey(now, timeZone);
  const weekStart = weekStartKey(now, timeZone);
  const weekEnd = addDate(weekStart, 6);
  const loads = await fitnessLoadsForUser(userId);
  const pmc = latestPmc(loads, timeZone);
  const completed = await completedFromActivities(userId, weekStart, weekEnd, timeZone);

  const keep = await db
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
    })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.weekStart, weekStart),
        eq(plannedSessions.status, "done"),
      ),
    );

  await db
    .delete(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, userId),
        eq(plannedSessions.weekStart, weekStart),
        lte(plannedSessions.date, weekEnd),
      ),
    );

  const preserved = keep.filter((row) => row.date < today).map(toPlanned);

  const settings = await getCalendarSettingsForUser(userId);
  const sportTypes = settings?.sportTypes ?? {};
  const drafts = planRemainingWeek({
    plan: { ...plan, timeZone },
    today,
    ctl: pmc.ctl,
    tsb: pmc.tsb,
    completed,
    collectors: {
      running: familyCollectors(sportTypes, "running"),
      cycling: familyCollectors(sportTypes, "cycling"),
    },
  });

  const nextStatus = mode === "adapt" ? ("adapted" as const) : ("planned" as const);
  const rows = [
    ...preserved.map((row) => ({
      ...row,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    ...drafts.map((draft) => ({
      id: crypto.randomUUID(),
      userId,
      ...draft,
      status: nextStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  ];

  if (rows.length) {
    await db.insert(plannedSessions).values(rows);
  }

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    weekStart: row.weekStart,
    sportFamily: row.sportFamily,
    title: row.title,
    targetMinutes: row.targetMinutes,
    targetLoad: row.targetLoad,
    status: row.status,
    note: row.note ?? null,
  }));
}

function addDate(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
