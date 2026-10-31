import { createHash } from "node:crypto";

import { and, eq, gte, lt, ne, or } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, coachPlans } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { storedPlanningStyle } from "./athlete-settings.server.ts";
import { coachModelFor } from "./coach-model.server.ts";
import { weekBudgets, weeklyKm, type RunDay } from "./coach-plan-budget.ts";
import type { RuleContext } from "./coach-plan-rules.ts";
import {
  availabilityText,
  paceText,
  rulesFor,
  weeksText,
  writeSessions,
} from "./coach-plan-writer.server.ts";
import {
  coachPlanGoal,
  parseAvailability,
  plannedRun,
  type Availability,
  type CoachPlan,
  type CoachPlanMissing,
  type CoachPlanState,
  type CoachPlanStatus,
  type PlanBasis,
  type PlannedRun,
} from "./coach-plan.types.ts";
import { addDayKey, dayKey, weekStartKey } from "./day-key.ts";
import { goalsFor } from "./season.server.ts";
import { daysBetween, type Goal } from "./season.types.ts";
import { sportGroupFor } from "./sport-groups.ts";
import { trainingPacesFor } from "./training-paces.server.ts";

/** The current week and the three after it are written (ADR 0037). */
const WEEKS_AHEAD = 4;
/** Weeks gone by stay with the plan, frozen, this long. */
const KEEP_PAST_WEEKS = 12;
/** History read for the budget's floor: six months and the week before. */
const HISTORY_DAYS = 27 * 7;
/** Writing marked as running for longer than this stopped with the server. */
const STALE_WRITING_MS = 10 * 60_000;
/** A run on the session's day covering this share of its distance counts as doing it. */
const DONE_SHARE = 0.7;
/**
 * Paces drift a little every day as old runs fade (ADR 0039); a plan is written again when the
 * VDOT has moved this far since, about 2 % in pace, rather than on every small step.
 */
const PACE_CHANGE_VDOT = 1;

type Row = typeof coachPlans.$inferSelect;
type Activity = { date: string; sportType: string; km: number; minutes: number };

async function readRow(userId: string): Promise<Row | null> {
  const [row] = await db.select().from(coachPlans).where(eq(coachPlans.userId, userId)).limit(1);
  return row ?? null;
}

/** Everything the plan is checked and written from, read fresh. */
async function gather(userId: string, now = new Date()) {
  const [row, style, goals, coach, paces, rows] = await Promise.all([
    readRow(userId),
    storedPlanningStyle(userId),
    goalsFor(userId),
    coachModelFor(userId, "plan"),
    trainingPacesFor(userId, now),
    db
      .select({
        sportType: activities.sportType,
        startDate: activities.startDate,
        distance: activities.distance,
        movingTime: activities.movingTime,
      })
      .from(activities)
      .where(
        and(
          eq(activities.userId, userId),
          gte(activities.startDate, new Date(now.getTime() - HISTORY_DAYS * 86_400_000)),
        ),
      ),
  ]);
  const timeZone = row?.timeZone ?? "UTC";
  const today = dayKey(now, timeZone);
  const all: Activity[] = rows.map((item) => ({
    date: dayKey(item.startDate, timeZone),
    sportType: item.sportType,
    km: (item.distance ?? 0) / 1000,
    minutes: Math.round(item.movingTime / 60),
  }));
  // Hidden sport types count: hiding changes views, not training (ADR 0018).
  const runs = all.filter((item) => sportGroupFor(item.sportType)?.id === "running");
  return {
    row,
    style,
    goals,
    coach,
    paces,
    now,
    today,
    currentWeek: weekStartKey(now, timeZone),
    availability: row ? parseAvailability(row.availability) : null,
    aGoal: coachPlanGoal(goals, today),
    plan: (row?.plan as CoachPlan | null) ?? null,
    runs: runs as RunDay[],
    others: all.filter((item) => sportGroupFor(item.sportType)?.id !== "running"),
  };
}

type Inputs = Awaited<ReturnType<typeof gather>>;

const vdotOf = (inputs: Inputs) => (inputs.paces.source === "none" ? null : inputs.paces.vdot);
const rangesOf = (inputs: Inputs) => (inputs.paces.source === "none" ? null : inputs.paces.paces);

function missingOf(inputs: Inputs): CoachPlanMissing[] {
  const missing: CoachPlanMissing[] = [];
  if (inputs.coach.kind === "missing") missing.push("key");
  if (!inputs.aGoal) missing.push("goal");
  if (!inputs.availability) missing.push("availability");
  return missing;
}

/** Sessions a single run on their day covered, at least 70 % of the distance. */
function doneSessions(plan: CoachPlan | null, runs: RunDay[], today: string) {
  if (!plan) return [];
  const longest = new Map<string, number>();
  for (const run of runs) longest.set(run.date, Math.max(longest.get(run.date) ?? 0, run.km));
  return plan.weeks
    .flatMap((week) => week.sessions)
    .filter(
      (session) =>
        session.date <= today &&
        (longest.get(session.date) ?? 0) >= session.distanceKm * DONE_SHARE,
    )
    .map((session) => session.id);
}

/** Goals the plan is written around: upcoming runs, and every upcoming A goal. */
function goalsKey(goals: Goal[], today: string) {
  return JSON.stringify(
    goals
      .filter(
        (goal) =>
          goal.date >= today &&
          (goal.priority === "A" || sportGroupFor(goal.sportType)?.id === "running"),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((goal) => [goal.id, goal.date, goal.distanceM, goal.priority, goal.sportType]),
  );
}

function basisOf(inputs: Inputs): PlanBasis {
  const done = new Set(doneSessions(inputs.plan, inputs.runs, inputs.today));
  const missed = (inputs.plan?.weeks ?? [])
    .flatMap((week) => week.sessions)
    .filter((session) => session.key && session.date < inputs.today && !done.has(session.id))
    .map((session) => session.id);
  return {
    availability: JSON.stringify(inputs.availability),
    goals: goalsKey(inputs.goals, inputs.today),
    vdot: vdotOf(inputs),
    missed,
  };
}

/** Today, or tomorrow once the athlete ran today: a run done is not written again. */
function firstDay(inputs: Inputs) {
  return inputs.runs.some((run) => run.date === inputs.today)
    ? addDayKey(inputs.today, 1)
    : inputs.today;
}

/**
 * Whether the weeks ahead need writing, and from which day: the first plan; the athlete asked
 * (switching back to the coach plan); availability, goals, or paces changed; a key session was
 * missed; or a new week is due. Days before it are frozen.
 */
export function dueWrite(
  inputs: Inputs,
  basis: PlanBasis,
): { from: string; reason: string } | null {
  const first = firstDay(inputs);
  const { plan, row } = inputs;
  if (!plan) return { from: first, reason: "first" };
  if (row?.requestedFrom) {
    return { from: row.requestedFrom > first ? row.requestedFrom : first, reason: "asked" };
  }
  if (plan.basis.availability !== basis.availability)
    return { from: first, reason: "availability" };
  if (plan.basis.goals !== basis.goals) return { from: first, reason: "goals" };
  const pacesChanged =
    (plan.basis.vdot == null) !== (basis.vdot == null) ||
    Math.abs((plan.basis.vdot ?? 0) - (basis.vdot ?? 0)) >= PACE_CHANGE_VDOT;
  if (pacesChanged) return { from: first, reason: "paces" };
  if (basis.missed.some((id) => !plan.basis.missed.includes(id))) {
    return { from: first, reason: "missed" };
  }
  const lastWeek = plan.weeks.at(-1)?.weekStart ?? "";
  if (lastWeek < addDayKey(inputs.currentWeek, 7 * (WEEKS_AHEAD - 1))) {
    const next = addDayKey(lastWeek, 7);
    return { from: lastWeek && next > first ? next : first, reason: "new week" };
  }
  return null;
}

function statusOf(row: Row | null, now: Date): { status: CoachPlanStatus; error: string | null } {
  if (!row) return { status: "idle", error: null };
  if (row.status === "writing" && now.getTime() - row.statusAt.getTime() > STALE_WRITING_MS) {
    return { status: "failed", error: "Writing stopped before it finished. Try again." };
  }
  return { status: row.status as CoachPlanStatus, error: row.error };
}

function stateOf(inputs: Inputs, row: Row | null): CoachPlanState {
  return {
    signedIn: true,
    today: inputs.today,
    availability: inputs.availability,
    aGoal: inputs.aGoal
      ? {
          id: inputs.aGoal.id,
          name: inputs.aGoal.name,
          date: inputs.aGoal.date,
          distanceM: inputs.aGoal.distanceM,
          sportType: inputs.aGoal.sportType,
        }
      : null,
    missing: missingOf(inputs),
    plan: (row?.plan as CoachPlan | null) ?? null,
    ...statusOf(row, inputs.now),
    done: doneSessions(inputs.plan, inputs.runs, inputs.today),
  };
}

/**
 * Starts writing when the plan is due and can be written, unless the same writing was already
 * tried: a failed one waits for the athlete's "Try again" rather than spending their credit on
 * every load. Returns the row as it is now.
 */
async function startIfDue(userId: string, inputs: Inputs, force = false): Promise<Row | null> {
  const { row } = inputs;
  if (!row || inputs.style !== "coachPlan" || missingOf(inputs).length) return row;
  const basis = basisOf(inputs);
  const due =
    dueWrite(inputs, basis) ?? (force ? { from: firstDay(inputs), reason: "again" } : null);
  if (!due) return row;
  const attemptKey = createHash("sha1")
    .update(JSON.stringify([due.from, basis]))
    .digest("hex");
  if (!force && row.attemptKey === attemptKey) return row;
  const stale = new Date(inputs.now.getTime() - STALE_WRITING_MS);
  const [claimed] = await db
    .update(coachPlans)
    .set({ status: "writing", error: null, statusAt: new Date(), attemptKey })
    .where(
      and(
        eq(coachPlans.userId, userId),
        or(ne(coachPlans.status, "writing"), lt(coachPlans.statusAt, stale)),
      ),
    )
    .returning();
  if (!claimed) return row;
  logger.info("coach_plan.writing", { from: due.from, reason: due.reason });
  // Not awaited: the writing outlives the request, so closing the app doesn't stop it.
  void writePlan(userId, due.from);
  return claimed;
}

async function finish(userId: string, values: Partial<Row>) {
  await db
    .update(coachPlans)
    .set({ ...values, statusAt: new Date(), updatedAt: new Date() })
    .where(eq(coachPlans.userId, userId));
}

function raceSession(goal: Goal): PlannedRun {
  return plannedRun(
    {
      date: goal.date,
      kind: "race",
      key: true,
      title: goal.name,
      why: `Your ${goal.priority} race.`,
      blocks: [
        {
          repeat: 1,
          steps: [
            {
              part: "work",
              distanceM: goal.distanceM,
              durationS: null,
              pace: null,
              effort: "hard",
            },
          ],
        },
      ],
    },
    null,
  );
}

function recentTraining(inputs: Inputs) {
  const since = addDayKey(inputs.today, -30);
  const lastFour = addDayKey(inputs.currentWeek, -28);
  const otherHours: Record<string, number> = {};
  for (const item of inputs.others) {
    if (item.date < lastFour || item.date >= inputs.currentWeek) continue;
    const group = sportGroupFor(item.sportType)?.label ?? "Other sports";
    otherHours[group] = (otherHours[group] ?? 0) + item.minutes / 60;
  }
  return {
    weeklyRunKmLast8Weeks: weeklyKm(inputs.runs, inputs.currentWeek, 8).map(
      (km) => Math.round(km * 10) / 10,
    ),
    longestRunLast30DaysKm:
      Math.round(
        Math.max(0, ...inputs.runs.filter((run) => run.date >= since).map((run) => run.km)) * 10,
      ) / 10,
    // Rides, swims, and the rest count toward load: the coach sees them, but plans only runs.
    otherSportsHoursLast4Weeks: Object.fromEntries(
      Object.entries(otherHours).map(([group, hours]) => [group, Math.round(hours * 10) / 10]),
    ),
  };
}

/** Writes the weeks from `from`, keeps the days before it, and stores the plan if it passes. */
async function writePlan(userId: string, from: string) {
  try {
    const inputs = await gather(userId);
    const { availability, aGoal, coach } = inputs;
    if (!availability || !aGoal || coach.kind === "missing") {
      await finish(userId, { status: "failed", error: "The coach plan is missing its setup." });
      return;
    }
    const budgets = weekBudgets({
      runs: inputs.runs,
      goals: inputs.goals,
      aGoal,
      firstWeek: inputs.currentWeek,
      count: WEEKS_AHEAD,
      runsPerWeek: availability.runsPerWeek,
    });
    const fromWeek = weekStartKey(new Date(`${from}T12:00:00Z`), "UTC");
    const weeks = budgets.filter((week) => week.weekStart >= fromWeek);
    const old = inputs.plan?.weeks ?? [];
    const kept = old
      .flatMap((week) => week.sessions)
      .filter((session) => session.date >= fromWeek && session.date < from);
    const lastDay = addDayKey(weeks.at(-1)!.weekStart, 6);
    const races = inputs.goals.filter(
      (goal) =>
        sportGroupFor(goal.sportType)?.id === "running" &&
        goal.distanceM != null &&
        goal.date >= fromWeek &&
        goal.date <= lastDay,
    );
    const ctx: RuleContext = {
      availability,
      weeks,
      from,
      today: inputs.today,
      frozen: kept.filter((session) => session.kind !== "race"),
      runs: inputs.runs,
      raceDays: races.map((goal) => goal.date),
    };
    const ranges = rangesOf(inputs);
    const prompt = {
      task: `Write the athlete's runs from ${from} to ${lastDay}, toward their A goal, following the coaching knowledge and every rule below.`,
      today: inputs.today,
      aGoal: {
        name: aGoal.name,
        date: aGoal.date,
        sportType: aGoal.sportType,
        distanceKm: (aGoal.distanceM ?? 0) / 1000,
        weeksToGo: Math.floor(daysBetween(inputs.currentWeek, aGoal.date) / 7),
      },
      otherGoals: inputs.goals
        .filter((goal) => goal.id !== aGoal.id && goal.date >= inputs.today)
        .map((goal) => ({
          name: goal.name,
          date: goal.date,
          sportType: goal.sportType,
          distanceKm: goal.distanceM == null ? null : goal.distanceM / 1000,
          priority: goal.priority,
        })),
      availability: availabilityText(ctx),
      paces: paceText(ranges),
      weeks: weeksText(ctx),
      recentTraining: recentTraining(inputs),
      rules: rulesFor(ctx),
    };
    const result = await writeSessions(coach, prompt, ctx, ranges);
    if (!result.ok) {
      logger.warn("coach_plan.failed", { from });
      await finish(userId, { status: "failed", error: result.error });
      return;
    }
    const added = [
      ...kept,
      ...result.sessions,
      ...races.filter((goal) => goal.date >= from).map(raceSession),
    ];
    const plan: CoachPlan = {
      weeks: [
        ...old.filter(
          (week) =>
            week.weekStart < fromWeek &&
            week.weekStart >= addDayKey(inputs.currentWeek, -7 * KEEP_PAST_WEEKS),
        ),
        ...weeks.map((week) => ({
          ...week,
          sessions: added
            .filter(
              (session) =>
                session.date >= week.weekStart && session.date <= addDayKey(week.weekStart, 6),
            )
            .sort((a, b) => a.date.localeCompare(b.date)),
        })),
      ],
      basis: basisOf(inputs),
      writtenAt: new Date().toISOString(),
      model: coach.model,
    };
    await finish(userId, { plan, status: "idle", error: null, requestedFrom: null });
    logger.info("coach_plan.written", { from, sessions: result.sessions.length });
  } catch (error) {
    logger.error("coach_plan.crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await finish(userId, {
      status: "failed",
      error: "Something went wrong writing the plan. Try again.",
    });
  }
}

const SIGNED_OUT: CoachPlanState = {
  signedIn: false,
  today: "",
  availability: null,
  aGoal: null,
  missing: [],
  plan: null,
  status: "idle",
  error: null,
  done: [],
};

/** The stored plan, starting a writing when one is due (only under the coach plan). */
export async function loadCoachPlanImpl(): Promise<CoachPlanState> {
  const session = await getOptionalSession();
  if (!session) return SIGNED_OUT;
  const inputs = await gather(session.user.id);
  return stateOf(inputs, await startIfDue(session.user.id, inputs));
}

/** Saves availability; a change rewrites the weeks ahead from today (dueWrite). */
export async function saveAvailabilityImpl(
  availability: Availability,
  timeZone: string,
): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const values = { availability, timeZone, updatedAt: new Date() };
  await db
    .insert(coachPlans)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: coachPlans.userId, set: values });
  logger.info("coach_plan.availability_saved", { runsPerWeek: availability.runsPerWeek });
  const inputs = await gather(userId);
  return stateOf(inputs, await startIfDue(userId, inputs));
}

/** The athlete's "Try again" after a failed writing, or "Write my plan" with nothing due. */
export async function writeCoachPlanAgainImpl(): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  const inputs = await gather(session.user.id);
  return stateOf(inputs, await startIfDue(session.user.id, inputs, true));
}

/**
 * Switching back to the coach plan writes it again from today: the weeks kept while away were
 * written for an athlete who wasn't following them.
 */
export async function requestCoachPlanRewrite(userId: string) {
  const row = await readRow(userId);
  if (!row) return;
  await db
    .update(coachPlans)
    .set({ requestedFrom: dayKey(new Date(), row.timeZone), updatedAt: new Date() })
    .where(eq(coachPlans.userId, userId));
}
