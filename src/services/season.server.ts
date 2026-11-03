import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, coachPlans, goals } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getAthleteSettings } from "./athlete-settings.server.ts";
import { projectSeason, weekLoadsBefore } from "./season-phase.ts";
import { buildPmc, toFitnessLoad } from "./training-load.ts";
import { trainingPacesFor } from "./training-paces.server.ts";
import { predictsRaceTime } from "./training-paces.types.ts";
import { addDayKey, dayKey, weekStartKey } from "./day-key.ts";
import {
  LEG_SEPARATOR,
  goalSportTypes,
  newGoals,
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

/** Load per hour when the athlete has too little recent history to read their own. */
const DEFAULT_LOAD_PER_HOUR = 42;

/** The athlete's load per hour over recent days, to turn the season map's load into hours. */
function recentLoadPerHour(history: { minutes: number; load: number }[]) {
  let minutes = 0;
  let load = 0;
  for (const day of history) {
    minutes += day.minutes;
    load += day.load;
  }
  if (minutes < 120 || load <= 0) return DEFAULT_LOAD_PER_HOUR;
  return Math.min(90, Math.max(25, load / (minutes / 60)));
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

/** Fitness now and the last four weeks' loads, for the season map. */
export async function seasonContext(userId: string, timeZone: string, weekStart: string) {
  const rows = await db
    .select({
      startDate: activities.startDate,
      movingTime: activities.movingTime,
      trainingLoad: activities.trainingLoad,
      loadSource: activities.loadSource,
    })
    .from(activities)
    .where(eq(activities.userId, userId));
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
  const beforeWeek = [...pmc].reverse().find((point) => point.date < weekStart);
  const days = rows.map((row) => ({
    date: dayKey(row.startDate, timeZone),
    minutes: Math.round(row.movingTime / 60),
    load: row.trainingLoad ?? 0,
  }));
  const weekLoads = weekLoadsBefore(days, weekStart);
  const history = days.filter(
    (day) => day.date < weekStart && day.date >= addDayKey(weekStart, -7 * 8),
  );
  return {
    fitness: beforeWeek ? { ctl: beforeWeek.ctl, atl: beforeWeek.atl } : { ctl: 0, atl: 0 },
    weekLoads,
    loadPerHour: recentLoadPerHour(history),
  };
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
      map: [],
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
  const weekStart = weekStartKey(now, timeZone);
  const past = all
    .filter((goal) => goal.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const upcoming = seasonEvents(all.filter((goal) => goal.date >= today));
  const predicts = upcoming.some((event) =>
    event.goals.some((goal) => predictsRaceTime(goal.sportType) && goal.distanceM != null),
  );
  const [matched, context, paces] = await Promise.all([
    matchPastActivities(userId, past, timeZone),
    upcoming.length ? seasonContext(userId, timeZone, weekStart) : null,
    predicts ? trainingPacesFor(userId, now) : null,
  ]);

  let map: SeasonData["map"] = [];
  if (context) {
    const last = upcoming.at(-1)!.date;
    map = projectSeason(context.fitness, all, weekStart, addDayKey(last, 7), context.weekLoads).map(
      (week) => ({
        weekStart: week.weekStart,
        kind: week.phase.kind,
        lighter: week.phase.lighter,
        hours: Math.round((week.load / context.loadPerHour) * 10) / 10,
      }),
    );
  }

  return {
    signedIn: true,
    sportTypes: goalSportTypes(settings.sportTypes),
    today,
    upcoming,
    past: matched.reverse(),
    map,
    ...(paces ? { vdot: paces.source === "none" ? null : paces.vdot } : {}),
  };
}

/** The legs of `goal`'s event: same date and same name before the leg separator. */
function siblingsOf(goal: Goal, all: Goal[]) {
  const base = goal.name.split(LEG_SEPARATOR)[0]!.trim();
  return all.filter(
    (other) =>
      other.id !== goal.id &&
      other.date === goal.date &&
      other.name.split(LEG_SEPARATOR)[0]!.trim() === base,
  );
}

export async function createGoalImpl(data: GoalInput) {
  const session = await getRequiredSession();
  const id = crypto.randomUUID();
  await db.insert(goals).values({ id, userId: session.user.id, ...data });
  logger.info("goal.created", {
    sportType: data.sportType,
    priority: data.priority,
  });
  return { id };
}

/** Several sports on one date, such as a triathlon: one goal per leg, named "Event · Leg". */
export async function createEventImpl(data: { legs: GoalInput[] }) {
  const session = await getRequiredSession();
  const ids = data.legs.map(() => crypto.randomUUID());
  const { legs } = data;
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
  await db
    .update(goals)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)));
  // The legs of one event move, and matter, together.
  const siblings = siblingsOf(current, all);
  if (siblings.length) {
    await db
      .update(goals)
      .set({ date: data.date, priority: data.priority, updatedAt: new Date() })
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
