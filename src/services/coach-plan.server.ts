import { createHash } from "node:crypto";

import { and, eq, gte, lt, ne, or } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, athleteMetrics, coachPlans } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { storedPlanningStyle } from "./athlete-settings.server.ts";
import { coachModelFor } from "./coach-model.server.ts";
import { weekBudgets, weeklyAmount, type SportDay } from "./coach-plan-budget.ts";
import type { RuleContext } from "./coach-plan-rules.ts";
import {
  availabilityText,
  paceText,
  rulesFor,
  sessionLine,
  weeksText,
  writeSessions,
  zoneText,
} from "./coach-plan-writer.server.ts";
import {
  coachPlanGoal,
  availabilityKey,
  parseAvailability,
  plannedSession,
  planSportOf,
  readCoachPlan,
  sessionsPerWeek,
  stepSecPerKm,
  type Availability,
  type PlanAnchors,
  type CoachPlan,
  type CoachPlanMissing,
  type CoachPlanState,
  type CoachPlanStatus,
  type PlanBasis,
  type PlanGoal,
  type PlannedSession,
} from "./coach-plan.types.ts";
import { addDayKey, dayKey, weekStartKey } from "./day-key.ts";
import { mondayOf, seasonPhase } from "./season-phase.ts";
import { goalsFor } from "./season.server.ts";
import { parseHeartRateSettings } from "./heart-rate-settings.ts";
import { daysBetween, roughGoalHours, type Goal } from "./season.types.ts";
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
/**
 * An easy pace from zone 2 heart rate moves on its own, without the VDOT (ADR 0042): the plan is
 * written again once its middle moved this far, about what one VDOT point does to easy pace.
 */
const EASY_CHANGE_SEC_PER_KM = 10;
/** FTP drifts with every metered ride; the plan is written again once it moved this share. */
const FTP_CHANGE_SHARE = 0.05;

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
  const [row, style, goals, coach, paces, [metrics], rows] = await Promise.all([
    readRow(userId),
    storedPlanningStyle(userId),
    goalsFor(userId),
    coachModelFor(userId, "plan"),
    trainingPacesFor(userId, now),
    db
      .select({
        ftp: athleteMetrics.ftp,
        cyclingLthr: athleteMetrics.cyclingLthr,
        lthr: athleteMetrics.lthr,
        heartRate: athleteMetrics.heartRate,
      })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
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
  const runs = all.filter((item) => planSportOf(item.sportType) === "run");
  const rides = all.filter((item) => planSportOf(item.sportType) === "ride");
  // A cycling LTHR the athlete set wins over the estimate (ADR 0021).
  const rideLthr =
    parseHeartRateSettings(metrics?.heartRate).sports.cycling.lthr ??
    metrics?.cyclingLthr ??
    metrics?.lthr ??
    null;
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
    plan: readCoachPlan(row?.plan),
    runs: runs as (SportDay & Activity)[],
    rides: rides as (SportDay & Activity)[],
    ftp: metrics?.ftp ? Math.round(metrics.ftp) : null,
    rideLthr: rideLthr ? Math.round(rideLthr) : null,
    all,
    others: all.filter((item) => planSportOf(item.sportType) == null),
  };
}

export type Inputs = Awaited<ReturnType<typeof gather>>;

const vdotOf = (inputs: Inputs) => (inputs.paces.source === "none" ? null : inputs.paces.vdot);
function easyOf(inputs: Inputs): PlanBasis["easy"] {
  const { paces } = inputs;
  if (paces.source === "none") return null;
  const { fastSecPerKm, slowSecPerKm } = paces.paces.easy;
  return { from: paces.easySource, secPerKm: Math.round((fastSecPerKm + slowSecPerKm) / 2) };
}
export const rangesOf = (inputs: Inputs) =>
  inputs.paces.source === "none" ? null : inputs.paces.paces;

/** What planned steps aim at: paces for runs, FTP and cycling LTHR for rides. */
export const anchorsOf = (inputs: Inputs): PlanAnchors => ({
  paces: rangesOf(inputs),
  ftp: inputs.ftp,
  rideLthr: inputs.rideLthr,
});

function missingOf(inputs: Inputs): CoachPlanMissing[] {
  const missing: CoachPlanMissing[] = [];
  if (inputs.coach.kind === "missing") missing.push("key");
  if (!inputs.aGoal) missing.push("goal");
  if (!inputs.availability) missing.push("availability");
  // An A ride with no rides planned, or an A run with no runs, has nothing building toward it.
  const goalSport = inputs.aGoal ? planSportOf(inputs.aGoal.sportType) : null;
  if (inputs.availability && goalSport && sessionsPerWeek(inputs.availability, goalSport) === 0) {
    missing.push("goalSport");
  }
  return missing;
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

/** Goals the plan is written around: upcoming runs and rides, and every upcoming A goal. */
function planGoals(goals: Goal[], today: string): PlanGoal[] {
  return goals
    .filter(
      (goal) =>
        goal.date >= today && (goal.priority === "A" || planSportOf(goal.sportType) != null),
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
  return {
    availability: JSON.stringify(inputs.availability),
    goals: planGoals(inputs.goals, inputs.today),
    vdot: vdotOf(inputs),
    easy: easyOf(inputs),
    ftp: inputs.ftp,
  };
}

/** Whether FTP moved enough to rewrite. Plans written before FTP was kept aren't rewritten. */
function ftpChanged(written: PlanBasis["ftp"], now: PlanBasis["ftp"]) {
  if (written === undefined || (written ?? null) === (now ?? null)) return false;
  if (written == null || now == null) return true;
  return Math.abs(now - written) / written >= FTP_CHANGE_SHARE;
}

type Due = {
  /** The first week written: weeks before it are kept, and in it only done sessions are. */
  fromWeek: string;
  reason: string;
  /** What set the writing off, so a failed one is tried again only when that changes. */
  trigger: unknown;
};

/** The easy pace in steps of EASY_CHANGE_SEC_PER_KM, so a failed writing waits as the VDOT's does. */
const easyStep = (easy: PlanBasis["easy"]) =>
  easy ? Math.round(easy.secPerKm / EASY_CHANGE_SEC_PER_KM) : null;

/**
 * Whether the easy pace alone moved enough to rewrite. An easy pace read from the VDOT moves with
 * it, so the VDOT point covers it; only one from heart rate, before or now, is checked here.
 */
function easyChanged(written: PlanBasis["easy"], now: PlanBasis["easy"]) {
  if (written === undefined || written == null || now == null) return false;
  if (written.from !== "heartRate" && now.from !== "heartRate") return false;
  return Math.abs(written.secPerKm - now.secPerKm) >= EASY_CHANGE_SEC_PER_KM;
}

/**
 * Whether the weeks ahead need writing, and from which week: the first plan; the athlete asked
 * (switching back to the coach plan); availability, goals, or paces changed; or a new week is
 * due. A missed run is skipped, never a reason to write. Sessions marked done are kept.
 */
export function dueWrite(inputs: Inputs, basis: PlanBasis): Due | null {
  const first = inputs.currentWeek;
  const { plan, row, today } = inputs;
  const goals = upcomingGoalsKey(basis.goals, today);
  if (!plan) {
    return {
      fromWeek: first,
      reason: "first",
      trigger: [basis.availability, goals, vdotPoint(basis.vdot)],
    };
  }
  if (row?.requestedFrom) {
    const asked = mondayOf(row.requestedFrom);
    return { fromWeek: asked > first ? asked : first, reason: "asked", trigger: row.requestedFrom };
  }
  // Read through the schema, so a plan written when availability had minutes isn't rewritten.
  if (availabilityKey(JSON.parse(plan.basis.availability)) !== basis.availability) {
    return { fromWeek: first, reason: "availability", trigger: basis.availability };
  }
  if (upcomingGoalsKey(plan.basis.goals, today) !== goals) {
    return { fromWeek: first, reason: "goals", trigger: goals };
  }
  const pacesChanged =
    (plan.basis.vdot == null) !== (basis.vdot == null) ||
    Math.abs((plan.basis.vdot ?? 0) - (basis.vdot ?? 0)) >= PACE_CHANGE_VDOT;
  if (pacesChanged) return { fromWeek: first, reason: "paces", trigger: vdotPoint(basis.vdot) };
  if (easyChanged(plan.basis.easy, basis.easy)) {
    return { fromWeek: first, reason: "easy pace", trigger: easyStep(basis.easy) };
  }
  // FTP only shapes rides, so a plan without them isn't rewritten for it.
  if (inputs.availability?.ridesPerWeek && ftpChanged(plan.basis.ftp, basis.ftp)) {
    return { fromWeek: first, reason: "ftp", trigger: basis.ftp };
  }
  const lastWeek = plan.weeks.at(-1)?.weekStart ?? "";
  if (lastWeek < addDayKey(inputs.currentWeek, 7 * (WEEKS_AHEAD - 1))) {
    const next = addDayKey(lastWeek, 7);
    // Keyed on the week being added: a plan fallen behind would otherwise try again each day
    // after a failure.
    return { fromWeek: lastWeek && next > first ? next : first, reason: "new week", trigger: next };
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
    plan: readCoachPlan(row?.plan),
    ...statusOf(row, inputs.now),
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
    (force ? { fromWeek: inputs.currentWeek, reason: "again", trigger: null } : null);
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
  logger.info("coach_plan.writing", { fromWeek: due.fromWeek, reason: due.reason });
  // Not awaited: the writing outlives the request, so closing the app doesn't stop it.
  void writePlan(userId, due.fromWeek, claimed.statusAt);
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

/** A goal as its race session: a run by its distance, a ride by its rough time. */
function raceSession(goal: Goal): PlannedSession {
  const sport = planSportOf(goal.sportType) ?? "run";
  return plannedSession(
    {
      weekStart: mondayOf(goal.date),
      sport,
      kind: "race",
      title: goal.name,
      why: `Your ${goal.priority} race.`,
      blocks: [
        {
          repeat: 1,
          steps: [
            {
              part: "work",
              distanceM: sport === "run" ? goal.distanceM : null,
              durationS: sport === "ride" ? Math.round(roughGoalHours(goal) * 3600) : null,
              pace: null,
              zone: null,
              effort: "hard",
            },
          ],
        },
      ],
    },
    { paces: null, ftp: null, rideLthr: null },
  );
}

/** A race session as the next writing finds it again: its week and the goal's name. */
const raceKey = (session: PlannedSession) => `${session.weekStart} ${session.title}`;

const tenth = (value: number) => Math.round(value * 10) / 10;

function recentTraining(inputs: Inputs) {
  const since = addDayKey(inputs.today, -30);
  const lastFour = addDayKey(inputs.currentWeek, -28);
  const otherHours: Record<string, number> = {};
  for (const item of inputs.others) {
    if (item.date < lastFour || item.date >= inputs.currentWeek) continue;
    const group = sportGroupFor(item.sportType)?.label ?? "Other sports";
    otherHours[group] = (otherHours[group] ?? 0) + item.minutes / 60;
  }
  const recent = (days: SportDay[]) => days.filter((day) => day.date >= since);
  return {
    weeklyRunKmLast8Weeks: weeklyAmount(inputs.runs, inputs.currentWeek, 8, "run").map(tenth),
    longestRunLast30DaysKm: tenth(Math.max(0, ...recent(inputs.runs).map((run) => run.km))),
    weeklyRideHoursLast8Weeks: weeklyAmount(inputs.rides, inputs.currentWeek, 8, "ride").map(
      (minutes) => tenth(minutes / 60),
    ),
    longestRideLast30DaysMin: Math.max(0, ...recent(inputs.rides).map((ride) => ride.minutes)),
    // Swims, walks, and the rest count toward load: the coach sees them, but plans only runs and
    // rides.
    otherSportsHoursLast4Weeks: Object.fromEntries(
      Object.entries(otherHours).map(([group, hours]) => [group, tenth(hours)]),
    ),
  };
}

/**
 * Writes the weeks from `fromWeek`, keeps the weeks before it and the sessions marked done in it,
 * and stores the plan if it passes.
 */
async function writePlan(userId: string, fromWeek: string, claimedAt: Date) {
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
      rides: inputs.rides,
      goals: inputs.goals,
      aGoal,
      firstWeek: inputs.currentWeek,
      count: WEEKS_AHEAD,
      availability,
    });
    const weeks = budgets.filter((week) => week.weekStart >= fromWeek);
    const old = (inputs.plan?.weeks ?? []).flatMap((week) => week.sessions);
    // In the weeks written, the athlete's sessions marked done stay; the open ones are written
    // again.
    const kept = old.filter(
      (session) => session.weekStart >= fromWeek && session.done && session.kind !== "race",
    );
    // Weeks planned before the ones written, such as the weeks kept when only a new week is added:
    // they set the longest-session limit of the weeks after them, and count toward no week written.
    const neighbours = old.filter(
      (session) => session.weekStart >= inputs.currentWeek && session.weekStart < fromWeek,
    );
    const lastDay = addDayKey(weeks.at(-1)!.weekStart, 6);
    const races = inputs.goals.filter(
      (goal) =>
        planSportOf(goal.sportType) != null &&
        goal.distanceM != null &&
        goal.date >= fromWeek &&
        goal.date <= lastDay,
    );
    const anchors = anchorsOf(inputs);
    const ctx: RuleContext = {
      availability,
      weeks,
      fromWeek,
      today: inputs.today,
      frozen: kept,
      runs: inputs.runs,
      rides: inputs.rides,
      races: races.map((goal) => ({
        weekStart: mondayOf(goal.date),
        sport: planSportOf(goal.sportType)!,
      })),
      neighbours,
      easySecPerKm: stepSecPerKm(
        { part: "work", distanceM: 1000, durationS: null, pace: null, zone: null, effort: "easy" },
        anchors.paces,
      ),
    };
    const prompt = {
      task: `Write the athlete's sessions for each week from ${fromWeek} to ${weeks.at(-1)!.weekStart}, toward their A goal and the rest of their season, following the coaching knowledge and every rule below.`,
      today: inputs.today,
      aGoal: {
        name: aGoal.name,
        date: aGoal.date,
        sportType: aGoal.sportType,
        distanceKm: (aGoal.distanceM ?? 0) / 1000,
        elevationGainM: aGoal.elevationGainM,
        weeksToGo: Math.floor(daysBetween(inputs.currentWeek, aGoal.date) / 7),
      },
      otherGoals: inputs.goals
        .filter((goal) => goal.id !== aGoal.id && goal.date >= inputs.today)
        .map((goal) => ({
          name: goal.name,
          date: goal.date,
          sportType: goal.sportType,
          distanceKm: goal.distanceM == null ? null : goal.distanceM / 1000,
          elevationGainM: goal.elevationGainM,
          priority: goal.priority,
        })),
      availability: availabilityText(ctx),
      ...(availability.runsPerWeek ? { paces: paceText(anchors.paces) } : {}),
      ...(availability.ridesPerWeek ? { rideZones: zoneText(anchors) } : {}),
      weeks: weeksText(ctx),
      plannedBefore: neighbours.map((session) => `${session.weekStart} ${sessionLine(session)}`),
      recentTraining: recentTraining(inputs),
      rules: rulesFor(ctx),
    };
    const result = await writeSessions(coach, prompt, ctx, anchors);
    if (!result.ok) {
      logger.warn("coach_plan.failed", { fromWeek });
      await finish(userId, claimedAt, failedValues(inputs, result.error));
      return;
    }
    // A race is added again each writing; one the athlete marked done stays done.
    const doneRaces = new Set(
      old.filter((session) => session.kind === "race" && session.done).map(raceKey),
    );
    const added = [
      ...kept,
      ...result.sessions,
      ...races.map(raceSession).map((race) => ({ ...race, done: doneRaces.has(raceKey(race)) })),
    ];
    const plan: CoachPlan = {
      weeks: [
        ...(inputs.plan?.weeks ?? []).filter(
          (week) =>
            week.weekStart < fromWeek &&
            week.weekStart >= addDayKey(inputs.currentWeek, -7 * KEEP_PAST_WEEKS),
        ),
        ...weeks.map((week) => ({
          ...week,
          sessions: added.filter((session) => session.weekStart === week.weekStart),
        })),
      ],
      basis: basisOf(inputs),
      writtenAt: new Date().toISOString(),
      model: coach.model,
    };
    await finish(userId, claimedAt, { plan, status: "idle", error: null, requestedFrom: null });
    logger.info("coach_plan.written", { fromWeek, sessions: result.sessions.length });
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
  logger.info("coach_plan.availability_saved", {
    runsPerWeek: availability.runsPerWeek,
    ridesPerWeek: availability.ridesPerWeek,
  });
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
 * The athlete marks a session done, or open again (ADR 0048). Only from its week on: a week ahead
 * may still be written again. Not while a writing runs, since the writing would store the plan it
 * read and drop the mark.
 */
export async function markSessionImpl(sessionId: string, done: boolean): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const inputs = await gather(userId);
  const { plan, row } = inputs;
  const planned = plan?.weeks.flatMap((week) => week.sessions).find((s) => s.id === sessionId);
  if (!row || !plan || !planned) throw new Error("That session is no longer in your plan.");
  if (planned.weekStart > inputs.currentWeek) {
    throw new Error("A session can be marked done from its week on.");
  }
  const next: CoachPlan = {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      sessions: week.sessions.map((item) => (item.id === sessionId ? { ...item, done } : item)),
    })),
  };
  const stale = new Date(inputs.now.getTime() - STALE_WRITING_MS);
  const [saved] = await db
    .update(coachPlans)
    .set({ plan: next, updatedAt: new Date() })
    .where(
      and(
        eq(coachPlans.userId, userId),
        or(ne(coachPlans.status, "writing"), lt(coachPlans.statusAt, stale)),
      ),
    )
    .returning();
  if (!saved) throw new Error("Your plan is being written again: mark it once it's written.");
  logger.info("coach_plan.session_marked", { done });
  return stateOf({ ...inputs, plan: next }, saved);
}
