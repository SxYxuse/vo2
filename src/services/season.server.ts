import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, coachPlans, goals } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { trainingPacesFor } from "./training-paces.server.ts";
import { predictsRaceTime } from "./training-paces.types.ts";
import { addDayKey, dayKey } from "./day-key.ts";
import { supportingRaceBlock } from "./season-phase.ts";
import {
  goalSportTypes,
  newGoals,
  otherLegs,
  seasonEvents,
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
  priority: goals.priority,
  effort: goals.effort,
};

export async function goalsFor(userId: string): Promise<Goal[]> {
  const rows = await db.select(goalColumns).from(goals).where(eq(goals.userId, userId));
  return rows as Goal[];
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

/** The time zone saved with the coach plan's availability, else UTC. */
export async function athleteTimeZone(userId: string) {
  const [row] = await db
    .select({ timeZone: coachPlans.timeZone })
    .from(coachPlans)
    .where(eq(coachPlans.userId, userId))
    .limit(1);
  return row?.timeZone ?? "UTC";
}

export async function loadSeasonImpl(): Promise<SeasonData> {
  const session = await getOptionalSession();
  if (!session) {
    return {
      signedIn: false,
      sportTypes: goalSportTypes({}),
      today: dayKey(new Date(), "UTC"),
      upcoming: [],
      past: [],
    };
  }
  const userId = session.user.id;
  const [all, timeZone, settings] = await Promise.all([
    goalsFor(userId),
    athleteTimeZone(userId),
    getAthleteSettings(userId),
  ]);
  const now = new Date();
  const today = dayKey(now, timeZone);
  const past = all
    .filter((goal) => goal.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const upcoming = seasonEvents(all.filter((goal) => goal.date >= today));
  const predicts = upcoming.some((event) =>
    event.goals.some((goal) => predictsRaceTime(goal.sportType) && goal.distanceM != null),
  );
  const [matched, paces] = await Promise.all([
    matchPastActivities(userId, past, timeZone),
    predicts ? trainingPacesFor(userId, now) : null,
  ]);

  return {
    signedIn: true,
    sportTypes: goalSportTypes(settings.sportTypes),
    today,
    upcoming,
    past: matched.reverse(),
    ...(paces ? { vdot: paces.source === "none" ? null : paces.vdot } : {}),
  };
}

/** Refuses a supporting race in a main goal's taper, as the goal form does (ADR 0052). */
async function assertRaceFits(userId: string, race: GoalInput, except: string[] = []) {
  const block = supportingRaceBlock(
    await goalsFor(userId),
    {
      date: race.date,
      priority: race.priority ?? "A",
    },
    except,
  );
  if (block) throw new Error(block);
}

export async function createGoalImpl(data: GoalInput) {
  const session = await getRequiredSession();
  await assertRaceFits(session.user.id, data);
  const id = crypto.randomUUID();
  await db.insert(goals).values({ id, userId: session.user.id, ...data });
  logger.info("goal.created", {
    sportType: data.sportType,
    priority: data.priority,
    effort: data.effort,
  });
  return { id };
}

/** Several sports on one date, such as a triathlon: one goal per leg, named "Event · Leg". */
export async function createEventImpl(data: { legs: GoalInput[] }) {
  const session = await getRequiredSession();
  const ids = data.legs.map(() => crypto.randomUUID());
  const { legs } = data;
  await assertRaceFits(session.user.id, legs[0]!);
  await db
    .insert(goals)
    .values(legs.map((leg, index) => ({ id: ids[index]!, userId: session.user.id, ...leg })));
  logger.info("goal.event_created", { legs: legs.length });
  return { ids };
}

export async function updateGoalImpl({ id, ...data }: GoalInput & { id: string }) {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const all = await goalsFor(userId);
  const current = all.find((goal) => goal.id === id);
  if (!current) return;
  // The legs of one event move, and matter, together.
  const siblings = otherLegs(current, all);
  const block = supportingRaceBlock(all, { date: data.date, priority: data.priority ?? "A" }, [
    id,
    ...siblings.map((goal) => goal.id),
  ]);
  if (block) throw new Error(block);
  await db
    .update(goals)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)));
  if (siblings.length) {
    await db
      .update(goals)
      .set({
        date: data.date,
        priority: data.priority,
        effort: data.effort ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(goals.userId, userId),
          inArray(
            goals.id,
            siblings.map((goal) => goal.id),
          ),
        ),
      );
  }
}

/** Adds a copied season's goals, skipping those already on this athlete's season. */
export async function pasteSeasonImpl(pasted: GoalInput[]) {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const added = newGoals(pasted, await goalsFor(userId));
  if (added.length) {
    await db
      .insert(goals)
      .values(added.map((goal) => ({ id: crypto.randomUUID(), userId, ...goal })));
  }
  logger.info("goal.season_pasted", { added: added.length, skipped: pasted.length - added.length });
  return { added: added.length, skipped: pasted.length - added.length };
}

export async function deleteGoalImpl(id: string) {
  const session = await getRequiredSession();
  await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, session.user.id)));
}
