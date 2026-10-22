import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, goals } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import { addDayKey, dayKey } from "./training-plan.types.ts";
import {
  mainFlagsAfterPick,
  normalizedMainFlags,
  seasonClusters,
  type Goal,
  type GoalInput,
  type PastGoal,
  type SeasonData,
} from "./season.types.ts";

const goalColumns = {
  id: goals.id,
  name: goals.name,
  sportType: goals.sportType,
  date: goals.date,
  distanceM: goals.distanceM,
  elevationGainM: goals.elevationGainM,
  objective: goals.objective,
  main: goals.main,
};

async function goalsFor(userId: string): Promise<Goal[]> {
  const rows = await db.select(goalColumns).from(goals).where(eq(goals.userId, userId));
  return rows as Goal[];
}

/** Writes the main flags that changed. */
async function saveMainFlags(userId: string, current: Goal[], flags: Map<string, boolean>) {
  const changed = current.filter((goal) => (flags.get(goal.id) ?? false) !== goal.main);
  await Promise.all(
    changed.map((goal) =>
      db
        .update(goals)
        .set({ main: !goal.main, updatedAt: new Date() })
        .where(and(eq(goals.id, goal.id), eq(goals.userId, userId))),
    ),
  );
}

async function normalizeMainFlags(userId: string) {
  const current = await goalsFor(userId);
  await saveMainFlags(userId, current, normalizedMainFlags(current));
}

/** Past goals (oldest first) with the longest activity of their sport type on their date. */
async function matchPastActivities(
  userId: string,
  past: Goal[],
  timeZone: string,
): Promise<PastGoal[]> {
  if (!past.length) return [];
  const first = past[0]!.date;
  const last = past.at(-1)!.date;
  const rows = await db
    .select({
      id: activities.id,
      sportType: activities.sportType,
      startDate: activities.startDate,
      elapsedTime: activities.elapsedTime,
    })
    .from(activities)
    .where(
      and(
        eq(activities.userId, userId),
        inArray(activities.sportType, [...new Set(past.map((goal) => goal.sportType))]),
        gte(activities.startDate, new Date(`${addDayKey(first, -1)}T00:00:00Z`)),
        lte(activities.startDate, new Date(`${addDayKey(last, 2)}T00:00:00Z`)),
      ),
    );
  return past.map((goal) => {
    const match = rows
      .filter(
        (row) => row.sportType === goal.sportType && dayKey(row.startDate, timeZone) === goal.date,
      )
      .sort((a, b) => b.elapsedTime - a.elapsedTime)[0];
    return { ...goal, activityId: match?.id ?? null };
  });
}

export async function loadSeasonImpl(): Promise<SeasonData> {
  const session = await getOptionalSession();
  if (!session) {
    return { signedIn: false, today: dayKey(new Date(), "UTC"), upcoming: [], past: [] };
  }
  const userId = session.user.id;
  const [all, plan] = await Promise.all([goalsFor(userId), getTrainingPlanForUser(userId)]);
  const timeZone = plan?.timeZone ?? "UTC";
  const today = dayKey(new Date(), timeZone);
  const past = all
    .filter((goal) => goal.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const matched = await matchPastActivities(userId, past, timeZone);
  return {
    signedIn: true,
    today,
    upcoming: seasonClusters(all.filter((goal) => goal.date >= today)),
    past: matched.reverse(),
  };
}

export async function createGoalImpl(data: GoalInput) {
  const session = await getRequiredSession();
  const id = crypto.randomUUID();
  await db.insert(goals).values({ id, userId: session.user.id, ...data });
  await normalizeMainFlags(session.user.id);
  logger.info("goal.created", { sportType: data.sportType, objective: data.objective });
  return { id };
}

export async function updateGoalImpl({ id, ...data }: GoalInput & { id: string }) {
  const session = await getRequiredSession();
  await db
    .update(goals)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.userId, session.user.id)));
  await normalizeMainFlags(session.user.id);
}

export async function deleteGoalImpl(id: string) {
  const session = await getRequiredSession();
  await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, session.user.id)));
  await normalizeMainFlags(session.user.id);
}

export async function pickMainGoalImpl(id: string) {
  const session = await getRequiredSession();
  const current = await goalsFor(session.user.id);
  await saveMainFlags(session.user.id, current, mainFlagsAfterPick(current, id));
  logger.info("goal.main_picked");
}
