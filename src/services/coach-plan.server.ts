import { createHash } from "node:crypto";

import { and, eq, gte, lt, ne, or } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, coachPlans, syncRuns } from "@/db/schema.ts";
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
  matchSessions,
  availabilityKey,
  parseAvailability,
  parseLinks,
  plannedRun,
  stepSecPerKm,
  type Availability,
  type CoachPlan,
  type CoachPlanMissing,
  type CoachPlanState,
  type CoachPlanStatus,
  type PlanBasis,
  type PlanActivity,
  type PlanGoal,
  type PlannedRun,
} from "./coach-plan.types.ts";
import { addDayKey, dayKey, weekStartKey } from "./day-key.ts";
import { mondayOf, seasonPhase } from "./season-phase.ts";
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
/**
 * Paces drift a little every day as old runs fade (ADR 0039); a plan is written again when the
 * VDOT has moved this far since, about 2 % in pace, rather than on every small step.
 */
const PACE_CHANGE_VDOT = 1;

type Row = typeof coachPlans.$inferSelect;
type Activity = {
  id: string;
  name: string;
  date: string;
  sportType: string;
  km: number;
  seconds: number;
  minutes: number;
};

async function readRow(userId: string): Promise<Row | null> {
  const [row] = await db.select().from(coachPlans).where(eq(coachPlans.userId, userId)).limit(1);
  return row ?? null;
}

/** Everything the plan is checked and written from, read fresh. */
export async function gather(userId: string, now = new Date()) {
  const [row, style, goals, coach, paces, rows, [sync]] = await Promise.all([
    readRow(userId),
    storedPlanningStyle(userId),
    goalsFor(userId),
    coachModelFor(userId, "plan"),
    trainingPacesFor(userId, now),
    db
      .select({
        id: activities.id,
        name: activities.name,
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
    db
      .select({ status: syncRuns.status, updatedAt: syncRuns.updatedAt })
      .from(syncRuns)
      .where(eq(syncRuns.userId, userId))
      .limit(1),
  ]);
  const timeZone = row?.timeZone ?? "UTC";
  const today = dayKey(now, timeZone);
  const all: Activity[] = rows.map((item) => ({
    id: item.id,
    name: item.name,
    seconds: item.movingTime,
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
    // A sync that copied the newest activities, paused or not finished with the oldest ones:
    // runs on the days before the day it ended are in the local copy.
    syncedDay:
      sync && (sync.status === "complete" || sync.status === "incomplete")
        ? dayKey(sync.updatedAt, timeZone)
        : null,
    availability: row ? parseAvailability(row.availability) : null,
    aGoal: coachPlanGoal(goals, today),
    plan: (row?.plan as CoachPlan | null) ?? null,
    links: parseLinks(row?.links),
    runs: runs as (RunDay & Activity)[],
    all,
    others: all.filter((item) => sportGroupFor(item.sportType)?.id !== "running"),
  };
}

export type Inputs = Awaited<ReturnType<typeof gather>>;

const vdotOf = (inputs: Inputs) => (inputs.paces.source === "none" ? null : inputs.paces.vdot);
export const rangesOf = (inputs: Inputs) =>
  inputs.paces.source === "none" ? null : inputs.paces.paces;

function missingOf(inputs: Inputs): CoachPlanMissing[] {
  const missing: CoachPlanMissing[] = [];
  if (inputs.coach.kind === "missing") missing.push("key");
  if (!inputs.aGoal) missing.push("goal");
  if (!inputs.availability) missing.push("availability");
  return missing;
}

/** Which run did each session: the athlete's links win over the 70 % match. */
export function matchOf(inputs: Pick<Inputs, "plan" | "runs" | "links" | "today">) {
  const sessions = (inputs.plan?.weeks ?? []).flatMap((week) => week.sessions);
  return matchSessions(sessions, inputs.runs, inputs.links, inputs.today);
}

/** The activities over the plan's weeks, each with the session it did. */
function planActivities(inputs: Inputs): PlanActivity[] {
  const from = inputs.plan?.weeks[0]?.weekStart ?? inputs.currentWeek;
  const bySession = new Map(
    [...matchOf(inputs)].map(([sessionId, match]) => [match.runId, { sessionId, ...match }]),
  );
  return inputs.all
    .filter((item) => item.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      id: item.id,
      date: item.date,
      name: item.name,
      sportType: item.sportType,
      km: Math.round(item.km * 100) / 100,
      seconds: item.seconds,
      sessionId: bySession.get(item.id)?.sessionId ?? null,
      manual: bySession.get(item.id)?.manual ?? false,
    }));
}

/** The weeks from this one to the A race, each with its season phase. */
function roadOf(inputs: Inputs) {
  if (!inputs.aGoal) return [];
  const road = [];
  for (
    let week = inputs.currentWeek;
    week <= mondayOf(inputs.aGoal.date);
    week = addDayKey(week, 7)
  ) {
    road.push({ weekStart: week, phase: seasonPhase(inputs.goals, week).kind });
  }
  return road;
}

/** Goals the plan is written around: upcoming runs, and every upcoming A goal. */
function planGoals(goals: Goal[], today: string): PlanGoal[] {
  return goals
    .filter(
      (goal) =>
        goal.date >= today &&
        (goal.priority === "A" || sportGroupFor(goal.sportType)?.id === "running"),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((goal) => [goal.id, goal.date, goal.distanceM, goal.priority, goal.sportType]);
}

/**
 * The goals as they stand today, so a goal passing (the day after a race) changes nothing: only
 * one added, edited, or removed before its day rewrites the plan. Plans written before goals were
 * kept as a list stored them as text, hence `unknown`.
 */
function upcomingGoalsKey(goals: unknown, today: string) {
  if (!Array.isArray(goals)) return null;
  return JSON.stringify((goals as PlanGoal[]).filter((goal) => goal[1] >= today));
}

/** VDOT in whole points, so the drift of a day isn't a new writing (PACE_CHANGE_VDOT). */
const vdotPoint = (vdot: number | null) => (vdot == null ? null : Math.floor(vdot));

function basisOf(inputs: Inputs): PlanBasis {
  const done = matchOf(inputs);
  // A key session is missed only once a sync ended after its day: before that its run may just
  // not be copied yet (the app-open sync, a sync paused on Strava's limits).
  const { syncedDay } = inputs;
  const missed = (inputs.plan?.weeks ?? [])
    .flatMap((week) => week.sessions)
    .filter(
      (session) =>
        session.key &&
        session.date < inputs.today &&
        syncedDay != null &&
        session.date < syncedDay &&
        !done.has(session.id),
    )
    .map((session) => session.id);
  return {
    availability: JSON.stringify(inputs.availability),
    goals: planGoals(inputs.goals, inputs.today),
    vdot: vdotOf(inputs),
    missed,
  };
}

/** Today, or tomorrow once the athlete ran today: a run done is not written again. */
export function firstDay(inputs: Inputs) {
  return inputs.runs.some((run) => run.date === inputs.today)
    ? addDayKey(inputs.today, 1)
    : inputs.today;
}

type Due = {
  from: string;
  reason: string;
  /** What set the writing off, so a failed one is tried again only when that changes. */
  trigger: unknown;
};

/**
 * Whether the weeks ahead need writing, and from which day: the first plan; the athlete asked
 * (switching back to the coach plan); availability, goals, or paces changed; a key session was
 * missed; or a new week is due. Days before it are frozen.
 */
export function dueWrite(inputs: Inputs, basis: PlanBasis): Due | null {
  const first = firstDay(inputs);
  const { plan, row, today } = inputs;
  const goals = upcomingGoalsKey(basis.goals, today);
  if (!plan) {
    return {
      from: first,
      reason: "first",
      trigger: [basis.availability, goals, vdotPoint(basis.vdot)],
    };
  }
  if (row?.requestedFrom) {
    const from = row.requestedFrom > first ? row.requestedFrom : first;
    return { from, reason: "asked", trigger: row.requestedFrom };
  }
  // Read through the schema, so a plan written when availability had minutes isn't rewritten.
  if (availabilityKey(JSON.parse(plan.basis.availability)) !== basis.availability) {
    return { from: first, reason: "availability", trigger: basis.availability };
  }
  if (upcomingGoalsKey(plan.basis.goals, today) !== goals) {
    return { from: first, reason: "goals", trigger: goals };
  }
  const pacesChanged =
    (plan.basis.vdot == null) !== (basis.vdot == null) ||
    Math.abs((plan.basis.vdot ?? 0) - (basis.vdot ?? 0)) >= PACE_CHANGE_VDOT;
  if (pacesChanged) return { from: first, reason: "paces", trigger: vdotPoint(basis.vdot) };
  const missed = basis.missed.filter((id) => !plan.basis.missed.includes(id));
  if (missed.length) return { from: first, reason: "missed", trigger: missed };
  const lastWeek = plan.weeks.at(-1)?.weekStart ?? "";
  if (lastWeek < addDayKey(inputs.currentWeek, 7 * (WEEKS_AHEAD - 1))) {
    const next = addDayKey(lastWeek, 7);
    const from = lastWeek && next > first ? next : first;
    // Keyed on the week being added, not the day: a plan fallen behind would otherwise try again
    // each day after a failure.
    return { from, reason: "new week", trigger: next };
  }
  return null;
}

export function statusOf(
  row: Row | null,
  now: Date,
): { status: CoachPlanStatus; error: string | null } {
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
    activities: planActivities(inputs),
    road: roadOf(inputs),
    vdot: vdotOf(inputs),
  };
}

/**
 * From the trigger, not the day or the exact VDOT: a failed writing waits for "Try again" until
 * what set it off changes (ADR 0040).
 */
function attemptKeyOf(due: Due) {
  return createHash("sha1")
    .update(JSON.stringify([due.reason, due.trigger]))
    .digest("hex");
}

/**
 * A failed writing, held until "Try again". The rewrite the athlete asked for is cleared, so the
 * next real change gets its own key; the trigger then due is held as tried, since the writing asked
 * for already covered it and would otherwise start again on the next load. When the athlete's data
 * couldn't even be read (a database error), the next trigger is unknown: the rewrite asked for is
 * kept, so the key the writing claimed still holds it, rather than a lower trigger starting one
 * more writing on its own.
 */
function failedValues(inputs: Inputs | null, error: string): Partial<Row> {
  if (!inputs) return { status: "failed", error };
  const values: Partial<Row> = { status: "failed", error, requestedFrom: null };
  if (!inputs.row) return values;
  const next = dueWrite(
    { ...inputs, row: { ...inputs.row, requestedFrom: null } },
    basisOf(inputs),
  );
  return next ? { ...values, attemptKey: attemptKeyOf(next) } : values;
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
    dueWrite(inputs, basis) ??
    (force ? { from: firstDay(inputs), reason: "again", trigger: null } : null);
  if (!due) return row;
  const attemptKey = attemptKeyOf(due);
  // Only a failed writing waits for "Try again" (shown with its reason). One that succeeded and is
  // due again for the same trigger, such as switching back twice in a day, writes again, so a
  // rewrite asked for is always either written or shown as failed.
  if (!force && row.status === "failed" && row.attemptKey === attemptKey) return row;
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
  void writePlan(userId, due.from, claimed.statusAt);
  return claimed;
}

/**
 * Saves a writing's result, only while it still holds the claim: a writing that outlived its
 * claim (STALE_WRITING_MS) and was started again must not overwrite the newer one.
 */
async function finish(userId: string, claimedAt: Date, values: Partial<Row>) {
  await db
    .update(coachPlans)
    .set({ ...values, statusAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(coachPlans.userId, userId),
        eq(coachPlans.status, "writing"),
        eq(coachPlans.statusAt, claimedAt),
      ),
    );
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
async function writePlan(userId: string, from: string, claimedAt: Date) {
  let gathered: Inputs | null = null;
  try {
    const inputs = await gather(userId);
    gathered = inputs;
    const { availability, aGoal, coach } = inputs;
    if (!availability || !aGoal || coach.kind === "missing") {
      await finish(userId, claimedAt, failedValues(inputs, "The coach plan is missing its setup."));
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
    // Planned days around the ones written, such as the weeks kept when only a new week is added:
    // neighbours for the longest run and hard days, counted toward no week written.
    const neighbours = old
      .flatMap((week) => week.sessions)
      .filter((session) => session.date >= addDayKey(inputs.today, -1) && session.date < fromWeek);
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
      neighbours,
      easySecPerKm: stepSecPerKm(
        { part: "work", distanceM: 1000, durationS: null, pace: null, effort: "easy" },
        rangesOf(inputs),
      ),
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
      plannedBefore: neighbours.map(
        (session) => `${session.date} ${session.kind} ${session.distanceKm} km`,
      ),
      recentTraining: recentTraining(inputs),
      rules: rulesFor(ctx),
    };
    const result = await writeSessions(coach, prompt, ctx, ranges);
    if (!result.ok) {
      logger.warn("coach_plan.failed", { from });
      await finish(userId, claimedAt, failedValues(inputs, result.error));
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
    await finish(userId, claimedAt, { plan, status: "idle", error: null, requestedFrom: null });
    logger.info("coach_plan.written", { from, sessions: result.sessions.length });
  } catch (error) {
    logger.error("coach_plan.crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await finish(
      userId,
      claimedAt,
      failedValues(gathered, "Something went wrong writing the plan. Try again."),
    );
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
  activities: [],
  road: [],
  vdot: null,
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

/**
 * The athlete links a run to a session ("Link a run": one of that week's runs) or unlinks the one
 * matched ("Not this run", which then stays an extra). Their choice wins over the 70 % match.
 */
export async function linkRunImpl(
  sessionId: string,
  activityId: string | null,
): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const inputs = await gather(userId);
  const planned = inputs.plan?.weeks
    .flatMap((week) => week.sessions)
    .find((s) => s.id === sessionId);
  if (!inputs.row || !planned) throw new Error("That session is no longer in your plan.");
  const { linked, unlinked } = inputs.links;
  if (activityId == null) {
    const current = matchOf(inputs).get(sessionId);
    if (current) {
      delete linked[sessionId];
      if (!unlinked.includes(current.runId)) unlinked.push(current.runId);
    }
  } else {
    // A session still ahead may be written again as another kind, which drops its link.
    if (planned.date > inputs.today) throw new Error("A run can be linked from the session's day.");
    const weekStart = mondayOf(planned.date);
    const run = inputs.runs.find((item) => item.id === activityId);
    if (!run || mondayOf(run.date) !== weekStart) {
      throw new Error("Only a run from the session's week can be linked.");
    }
    for (const [id, runId] of Object.entries(linked)) if (runId === activityId) delete linked[id];
    linked[sessionId] = activityId;
    inputs.links.unlinked = unlinked.filter((id) => id !== activityId);
  }
  await db
    .update(coachPlans)
    .set({ links: inputs.links, updatedAt: new Date() })
    .where(eq(coachPlans.userId, userId));
  logger.info("coach_plan.run_linked", { linked: activityId != null });
  return stateOf(inputs, inputs.row);
}
