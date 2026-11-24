import { createHash } from "node:crypto";

import { and, eq, gte, lt, ne, or } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, athleteMetrics, coachPlans } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { storedPlanningStyle } from "./athlete-settings.server.ts";
import { coachModelFor } from "./coach-model.server.ts";
import {
  ceilingGoal,
  ceilingOf,
  firstWeekOffBudget,
  racePeak,
  recommendedPeak,
  seasonShape,
  sportSeed,
  withTimeOuts,
  STANDARD_GROWTH,
  weekBudgets,
  weeklyAmount,
  type SportDay,
} from "./coach-plan-budget.ts";
import { raceWeeks, type RuleContext } from "./coach-plan-rules.ts";
import {
  availabilityText,
  paceText,
  racePaceText,
  rulesFor,
  sessionLine,
  STALE_WRITING_MS,
  swimZoneText,
  weeksText,
  writeSessions,
  zoneText,
} from "./coach-plan-writer.server.ts";
import {
  coachPlanGoal,
  amountText,
  availabilityKey,
  parseAvailability,
  parseProgression,
  plannedSession,
  plannedSports,
  planSportOf,
  readCoachPlan,
  sessionsPerWeek,
  stepSecPerKm,
  swimSecPer100m,
  type Availability,
  type PlanAnchors,
  type CoachPlan,
  type CoachPlanMissing,
  type CoachPlanState,
  type CoachPlanStatus,
  type PlanBasis,
  type PlanGoal,
  type PlannedSession,
  type PlanSport,
  type Progression,
  type SeasonVolume,
} from "./coach-plan.types.ts";
import { addDayKey, dayKey, weekStartKey } from "./day-key.ts";
import { mondayOf, seasonWeeks } from "./season-phase.ts";
import { goalsFor } from "./goals.server.ts";
import { parseHeartRateSettings, storedCyclingLthr } from "./heart-rate-settings.ts";
import { daysBetween, effortLabel, roughGoalHours, type Goal } from "./season.types.ts";
import { sportGroupFor } from "./sport-groups.ts";
import { swimCssFor } from "./swim-css.server.ts";
import { timeOutsFor } from "./time-outs.server.ts";
import { timeOutOpen, timeOutsForCoach } from "./time-outs.ts";
import { trainingPacesFor } from "./training-paces.server.ts";
import { canPredict, predictRaceSeconds } from "./training-paces.types.ts";

const WEEKS_AHEAD = 4;
const BASE_WEEKS_SHOWN = 12;
const KEEP_PAST_WEEKS = 12;
const HISTORY_DAYS = 27 * 7;
const PACE_CHANGE_VDOT = 1;
const EASY_CHANGE_SEC_PER_KM = 10;
const FTP_CHANGE_SHARE = 0.05;
const CSS_CHANGE_SEC = 3;

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

export async function gather(userId: string, now = new Date()) {
  const [row, style, goals, coach, paces, css, timeOuts, [metrics], rows] = await Promise.all([
    readRow(userId),
    storedPlanningStyle(userId),
    goalsFor(userId),
    coachModelFor(userId, "plan"),
    trainingPacesFor(userId, now),
    swimCssFor(userId, now),
    timeOutsFor(userId),
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
  const runs = all.filter((item) => planSportOf(item.sportType) === "run");
  const rides = all.filter((item) => planSportOf(item.sportType) === "ride");
  const swims = all.filter((item) => planSportOf(item.sportType) === "swim");
  const rideLthr =
    parseHeartRateSettings(metrics?.heartRate).sports.cycling.lthr ?? storedCyclingLthr(metrics);
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
    progression: parseProgression(row?.progression),
    brief: row?.brief ?? "",
    timeOuts,
    aGoal: coachPlanGoal(goals, today),
    plan: readCoachPlan(row?.plan),
    runs: runs as (SportDay & Activity)[],
    rides: rides as (SportDay & Activity)[],
    swims: swims as (SportDay & Activity)[],
    ftp: metrics?.ftp ? Math.round(metrics.ftp) : null,
    css,
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

export function racePacesOf(inputs: Inputs) {
  const vdot = vdotOf(inputs);
  if (vdot == null) return [];
  return inputs.goals.flatMap((goal) => {
    const metres = goal.distanceM;
    if (goal.date < inputs.today || planSportOf(goal.sportType) !== "run") return [];
    if (metres == null || !canPredict(metres)) return [];
    const secPerKm = Math.round(predictRaceSeconds(vdot, metres) / (metres / 1000));
    return [{ name: goal.name, distanceKm: metres / 1000, secPerKm }];
  });
}

export const paceContext = (inputs: Inputs) => {
  const paces = rangesOf(inputs);
  return {
    easySecPer100m: swimSecPer100m({ zone: "endurance", effort: null }, inputs.css),
    easySecPerKm: stepSecPerKm(
      {
        part: "work",
        distanceM: 1000,
        durationS: null,
        pace: null,
        secPerKm: null,
        zone: null,
        effort: "easy",
        drill: null,
      },
      paces,
    ),
    paces,
    racePaces: racePacesOf(inputs).map((race) => race.secPerKm),
  };
};

export const anchorsOf = (inputs: Inputs): PlanAnchors => ({
  paces: rangesOf(inputs),
  ftp: inputs.ftp,
  rideLthr: inputs.rideLthr,
  css: inputs.css,
});

function missingOf(inputs: Inputs): CoachPlanMissing[] {
  const missing: CoachPlanMissing[] = [];
  if (inputs.coach.kind === "missing") missing.push("key");
  if (!inputs.availability) missing.push("availability");
  const goalSport = inputs.aGoal ? planSportOf(inputs.aGoal.sportType) : null;
  if (inputs.availability && goalSport && sessionsPerWeek(inputs.availability, goalSport) === 0) {
    missing.push("goalSport");
  }
  return missing;
}

const upcomingOf = (inputs: Inputs) =>
  inputs.goals
    .filter((goal) => goal.date >= inputs.today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

function roadOf(inputs: Inputs) {
  const last = upcomingOf(inputs).at(-1)?.date;
  const baseEnd = addDayKey(inputs.currentWeek, 7 * BASE_WEEKS_SHOWN - 1);
  const end = !inputs.aGoal && (!last || last < baseEnd) ? baseEnd : last;
  return end ? seasonWeeks(inputs.goals, inputs.currentWeek, end) : [];
}

function planGoals(goals: Goal[], today: string): PlanGoal[] {
  return goals
    .filter(
      (goal) =>
        goal.date >= today && (goal.priority === "A" || planSportOf(goal.sportType) != null),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((goal): PlanGoal => {
      const row = [goal.id, goal.date, goal.distanceM, goal.priority, goal.sportType] as const;
      return goal.effort ? [...row, goal.effort] : [...row];
    });
}

function upcomingGoalsKey(goals: unknown, today: string) {
  if (!Array.isArray(goals)) return null;
  return JSON.stringify((goals as PlanGoal[]).filter((goal) => goal[1] >= today));
}

const vdotPoint = (vdot: number | null) => (vdot == null ? null : Math.floor(vdot));

function basisOf(inputs: Inputs): PlanBasis {
  return {
    availability: JSON.stringify(inputs.availability),
    goals: planGoals(inputs.goals, inputs.today),
    vdot: vdotOf(inputs),
    easy: easyOf(inputs),
    ftp: inputs.ftp,
    css: inputs.css,
    brief: inputs.brief,
    timeOuts: timeOutsKey(inputs.timeOuts),
  };
}

const timeOutsKey = (timeOuts: Inputs["timeOuts"]) =>
  JSON.stringify(timeOuts.map(({ kind, start, end }) => [kind, start, end]));

const openTimeOut = (inputs: Pick<Inputs, "timeOuts" | "today">) =>
  inputs.timeOuts.some((timeOut) => timeOutOpen(timeOut, inputs.today));

function cssChanged(written: PlanBasis["css"], now: PlanBasis["css"]) {
  if (written === undefined || (written ?? null) === (now ?? null)) return false;
  if (written == null || now == null) return true;
  return Math.abs(now - written) >= CSS_CHANGE_SEC;
}

function ftpChanged(written: PlanBasis["ftp"], now: PlanBasis["ftp"]) {
  if (written === undefined || (written ?? null) === (now ?? null)) return false;
  if (written == null || now == null) return true;
  return Math.abs(now - written) / written >= FTP_CHANGE_SHARE;
}

type Due = {
  fromWeek: string;
  reason: string;
  trigger: unknown;
};

const easyStep = (easy: PlanBasis["easy"]) =>
  easy ? Math.round(easy.secPerKm / EASY_CHANGE_SEC_PER_KM) : null;

function easyChanged(written: PlanBasis["easy"], now: PlanBasis["easy"]) {
  if (written === undefined || written == null || now == null) return false;
  if (written.from !== "heartRate" && now.from !== "heartRate") return false;
  return Math.abs(written.secPerKm - now.secPerKm) >= EASY_CHANGE_SEC_PER_KM;
}

function dueWrite(inputs: Inputs, basis: PlanBasis): Due | null {
  const first = inputs.currentWeek;
  const { plan, row, today } = inputs;
  if (openTimeOut(inputs)) return null;
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
  if (availabilityKey(JSON.parse(plan.basis.availability)) !== basis.availability) {
    return { fromWeek: first, reason: "availability", trigger: basis.availability };
  }
  if ((plan.basis.brief ?? "") !== basis.brief) {
    return { fromWeek: first, reason: "brief", trigger: basis.brief };
  }
  if ((plan.basis.timeOuts ?? "[]") !== basis.timeOuts) {
    return { fromWeek: first, reason: "time outs", trigger: basis.timeOuts };
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
  if (inputs.availability?.ridesPerWeek && ftpChanged(plan.basis.ftp, basis.ftp)) {
    return { fromWeek: first, reason: "ftp", trigger: basis.ftp };
  }
  if (inputs.availability?.swimsPerWeek && cssChanged(plan.basis.css, basis.css)) {
    return { fromWeek: first, reason: "css", trigger: basis.css };
  }
  const lastWeek = plan.weeks.at(-1)?.weekStart ?? "";
  if (lastWeek < addDayKey(inputs.currentWeek, 7 * (WEEKS_AHEAD - 1))) {
    const next = addDayKey(lastWeek, 7);
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

function noActiveWriter(now: Date) {
  const stale = new Date(now.getTime() - STALE_WRITING_MS);
  return or(ne(coachPlans.status, "writing"), lt(coachPlans.statusAt, stale));
}

function stateOf(inputs: Inputs, row: Row | null): CoachPlanState {
  return {
    signedIn: true,
    today: inputs.today,
    availability: inputs.availability,
    brief: inputs.brief,
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
    goals: upcomingOf(inputs),
    vdot: vdotOf(inputs),
    volume: volumeOf(inputs),
  };
}

const daysOf = (inputs: Inputs, sport: PlanSport): SportDay[] =>
  sport === "run" ? inputs.runs : sport === "ride" ? inputs.rides : inputs.swims;

const dayAmount = (day: SportDay, sport: PlanSport) =>
  sport === "run" ? day.km : sport === "ride" ? day.minutes : day.km * 1000;

const SPORT_DOING: Record<PlanSport, string> = {
  run: "running",
  ride: "riding",
  swim: "swimming",
};

function volumeOf(inputs: Inputs): SeasonVolume | null {
  const { aGoal, availability, progression } = inputs;
  const road = roadOf(inputs);
  if (!availability || !road.length) return null;
  const shape = withTimeOuts(
    seasonShape(inputs.goals, aGoal, inputs.currentWeek, road.length),
    inputs.timeOuts,
  );
  const aSports = shape[0]?.anchorSports ?? [];
  return {
    shape,
    sports: plannedSports(availability).map((sport) => {
      const days = daysOf(inputs, sport);
      const seed = sportSeed(days, inputs.currentWeek, sessionsPerWeek(availability, sport), sport);
      const goal = ceilingGoal(inputs.goals, sport, inputs.currentWeek);
      return {
        sport,
        seed,
        growth: progression[sport]?.growth ?? null,
        defaultGrowth: !aGoal || aSports.includes(sport) ? STANDARD_GROWTH : 0,
        peak: progression[sport]?.peak ?? null,
        recommended: recommendedPeak(sport, seed.usual, goal),
        goal: goal ? { name: goal.name, floor: racePeak(sport, goal).floor } : null,
        doneThisWeek: days
          .filter((day) => day.date >= inputs.currentWeek)
          .reduce((sum, day) => sum + dayAmount(day, sport), 0),
      };
    }),
  };
}

export function ownPeakNotes(inputs: Inputs): string[] {
  const { availability, progression } = inputs;
  if (!availability) return [];
  return plannedSports(availability).flatMap((sport) => {
    const peak = progression[sport]?.peak;
    if (peak == null) return [];
    const perWeek = sessionsPerWeek(availability, sport);
    const seed = sportSeed(daysOf(inputs, sport), inputs.currentWeek, perWeek, sport);
    const recommended = ceilingOf(sport, seed, inputs.goals, inputs.currentWeek, {});
    if (peak <= recommended) return [];
    return [
      `The athlete chose their own ${SPORT_DOING[sport]} peak of ${amountText(sport, peak)} a week, above the ${amountText(sport, recommended)} VO2 recommends from their usual week. Respect it; bring it up only if they ask about their volume or report fatigue, pain, or injury.`,
    ];
  });
}

function attemptKeyOf(due: Due) {
  return createHash("sha1")
    .update(JSON.stringify([due.reason, due.trigger]))
    .digest("hex");
}

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

async function startIfDue(userId: string, inputs: Inputs, force = false): Promise<Row | null> {
  const { row } = inputs;
  if (!row || inputs.style !== "coachPlan") return row;
  if (openTimeOut(inputs)) return pause(userId, inputs, row);
  if (missingOf(inputs).length) return row;
  const basis = basisOf(inputs);
  const due =
    dueWrite(inputs, basis) ??
    (force ? { fromWeek: inputs.currentWeek, reason: "again", trigger: null } : null);
  if (!due) return row;
  const attemptKey = attemptKeyOf(due);
  if (!force && row.status === "failed" && row.attemptKey === attemptKey) return row;
  const [claimed] = await db
    .update(coachPlans)
    .set({ status: "writing", error: null, statusAt: new Date(), attemptKey })
    .where(and(eq(coachPlans.userId, userId), noActiveWriter(inputs.now)))
    .returning();
  if (!claimed) return row;
  logger.info("coach_plan.writing", { fromWeek: due.fromWeek, reason: due.reason });
  void writePlan(userId, due.fromWeek, claimed.statusAt);
  return claimed;
}

async function pause(userId: string, inputs: Inputs, row: Row): Promise<Row> {
  const { plan, currentWeek } = inputs;
  const timeOuts = timeOutsKey(inputs.timeOuts);
  const weeks = (plan?.weeks ?? [])
    .filter((week) => week.weekStart <= currentWeek)
    .map((week) =>
      week.weekStart < currentWeek
        ? week
        : { ...week, sessions: week.sessions.filter((session) => session.done) },
    );
  const paused =
    plan == null ||
    (plan.basis.timeOuts === timeOuts &&
      weeks.length === plan.weeks.length &&
      weeks.every((week, index) => week.sessions.length === plan.weeks[index]!.sessions.length));
  if (paused && row.status === "idle" && row.requestedFrom == null) return row;
  const [saved] = await db
    .update(coachPlans)
    .set({
      ...(plan ? { plan: { ...plan, weeks, basis: { ...plan.basis, timeOuts } } } : {}),
      status: "idle",
      error: null,
      requestedFrom: null,
      statusAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(coachPlans.userId, userId))
    .returning();
  logger.info("coach_plan.paused", { kept: weeks.at(-1)?.sessions.length ?? 0 });
  return saved ?? row;
}

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

function raceSession(goal: Goal): PlannedSession {
  const sport = planSportOf(goal.sportType) ?? "run";
  return plannedSession(
    {
      weekStart: mondayOf(goal.date),
      sport,
      kind: "race",
      title: goal.name,
      why:
        goal.priority === "A"
          ? "Your main goal: race it to perform."
          : `A supporting race: ${effortLabel(goal).toLowerCase()}.`,
      blocks: [
        {
          repeat: 1,
          steps: [
            {
              part: "work",
              distanceM: sport === "ride" ? null : goal.distanceM,
              durationS: sport === "ride" ? Math.round(roughGoalHours(goal) * 3600) : null,
              pace: null,
              secPerKm: null,
              zone: null,
              effort: "hard",
              drill: null,
            },
          ],
        },
      ],
    },
    { paces: null, ftp: null, rideLthr: null, css: null },
  );
}

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
    weeklySwimMetresLast8Weeks: weeklyAmount(inputs.swims, inputs.currentWeek, 8, "swim").map(
      Math.round,
    ),
    longestSwimLast30DaysM: Math.round(
      Math.max(0, ...recent(inputs.swims).map((swim) => swim.km * 1000)),
    ),
    otherSportsHoursLast4Weeks: Object.fromEntries(
      Object.entries(otherHours).map(([group, hours]) => [group, tenth(hours)]),
    ),
  };
}

function timeOutsText(inputs: Inputs, fromWeek: string, lastDay: string) {
  const since = addDayKey(fromWeek, -28);
  const relevant = inputs.timeOuts.filter(
    (timeOut) => timeOut.start <= lastDay && (timeOut.end == null || timeOut.end >= since),
  );
  return relevant.length ? { timeOuts: timeOutsForCoach(relevant, inputs.today) } : {};
}

async function writePlan(userId: string, fromWeek: string, claimedAt: Date) {
  let gathered: Inputs | null = null;
  try {
    const inputs = await gather(userId);
    gathered = inputs;
    const { availability, aGoal, coach } = inputs;
    if (!availability || coach.kind === "missing") {
      await finish(userId, claimedAt, failedValues(inputs, "The coach plan is missing its setup."));
      return;
    }
    const budgets = weekBudgets({
      runs: inputs.runs,
      rides: inputs.rides,
      swims: inputs.swims,
      goals: inputs.goals,
      aGoal,
      firstWeek: inputs.currentWeek,
      count: WEEKS_AHEAD,
      availability,
      progression: inputs.progression,
      timeOuts: inputs.timeOuts,
    });
    const weeks = budgets.filter((week) => week.weekStart >= fromWeek);
    const old = (inputs.plan?.weeks ?? []).flatMap((week) => week.sessions);
    const kept = old.filter(
      (session) => session.weekStart >= fromWeek && session.done && session.kind !== "race",
    );
    const neighbours = old.filter(
      (session) => session.weekStart >= inputs.currentWeek && session.weekStart < fromWeek,
    );
    const lastDay = addDayKey(weeks.at(-1)!.weekStart, 6);
    const races = raceWeeks(inputs.goals, fromWeek, lastDay);
    const anchors = anchorsOf(inputs);
    const ctx: RuleContext = {
      availability,
      weeks,
      fromWeek,
      today: inputs.today,
      frozen: kept,
      runs: inputs.runs,
      rides: inputs.rides,
      swims: inputs.swims,
      races: races.map(({ race }) => race),
      neighbours,
      ...paceContext(inputs),
    };
    const prompt = {
      task: `Write the athlete's sessions for each week from ${fromWeek} to ${weeks.at(-1)!.weekStart}, ${aGoal ? "toward their main goal (aGoal) and the rest of their season" : "building their base fitness: no main goal is ahead, so the weeks are mostly easy aerobic volume with a long session that grows and a little quality to stay sharp, around any supporting races in otherGoals"}, following the coaching knowledge and every rule below.`,
      today: inputs.today,
      aGoal: aGoal
        ? {
            name: aGoal.name,
            date: aGoal.date,
            sportType: aGoal.sportType,
            distanceKm: (aGoal.distanceM ?? 0) / 1000,
            elevationGainM: aGoal.elevationGainM,
            weeksToGo: Math.floor(daysBetween(inputs.currentWeek, aGoal.date) / 7),
          }
        : null,
      otherGoals: inputs.goals
        .filter((goal) => goal.id !== aGoal?.id && goal.date >= inputs.today)
        .map((goal) => ({
          name: goal.name,
          date: goal.date,
          sportType: goal.sportType,
          distanceKm: goal.distanceM == null ? null : goal.distanceM / 1000,
          elevationGainM: goal.elevationGainM,
          priority: goal.priority === "A" ? "main goal" : "supporting race",
          effort: effortLabel(goal),
        })),
      availability: availabilityText(ctx),
      ...(inputs.brief ? { brief: inputs.brief } : {}),
      ...timeOutsText(inputs, fromWeek, lastDay),
      ...(availability.runsPerWeek
        ? { paces: paceText(anchors.paces), racePaces: racePaceText(racePacesOf(inputs)) }
        : {}),
      ...(availability.ridesPerWeek ? { rideZones: zoneText(anchors) } : {}),
      ...(availability.swimsPerWeek ? { swimZones: swimZoneText(anchors) } : {}),
      weeks: weeksText(ctx),
      plannedBefore: neighbours.map((session) => `${session.weekStart} ${sessionLine(session)}`),
      recentTraining: recentTraining(inputs),
      athleteChoices: ownPeakNotes(inputs),
      rules: rulesFor(ctx),
    };
    const result = await writeSessions(coach, prompt, ctx, anchors, userId);
    if (!result.ok) {
      logger.warn("coach_plan.failed", { fromWeek });
      await finish(userId, claimedAt, failedValues(inputs, result.error));
      return;
    }
    const doneRaces = new Set(
      old.filter((session) => session.kind === "race" && session.done).map(raceKey),
    );
    const added = [
      ...kept,
      ...result.sessions,
      ...races
        .map(({ goal }) => raceSession(goal))
        .map((race) => ({ ...race, done: doneRaces.has(raceKey(race)) })),
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
      briefNotFit: result.briefNotFit,
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

async function currentState(userId: string, { force = false } = {}) {
  const inputs = await gather(userId);
  return stateOf(inputs, await startIfDue(userId, inputs, force));
}

const SIGNED_OUT: CoachPlanState = {
  signedIn: false,
  today: "",
  availability: null,
  brief: "",
  aGoal: null,
  missing: [],
  plan: null,
  status: "idle",
  error: null,
  road: [],
  goals: [],
  vdot: null,
  volume: null,
};

export async function loadCoachPlanImpl(): Promise<CoachPlanState> {
  const session = await getOptionalSession();
  if (!session) return SIGNED_OUT;
  return currentState(session.user.id);
}

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
    swimsPerWeek: availability.swimsPerWeek,
  });
  return currentState(userId);
}

export async function saveProgressionImpl(progression: Progression): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const before = await gather(userId);
  if (!before.row) throw new Error("Set your availability first.");
  const nextWeek = addDayKey(before.currentWeek, 7);
  let requestedFrom: string | null = null;
  if (before.plan && before.availability) {
    const budgets = weekBudgets({
      runs: before.runs,
      rides: before.rides,
      swims: before.swims,
      goals: before.goals,
      aGoal: before.aGoal,
      firstWeek: before.currentWeek,
      count: WEEKS_AHEAD,
      availability: before.availability,
      progression,
      timeOuts: before.timeOuts,
    });
    requestedFrom = firstWeekOffBudget(before.plan.weeks, budgets, nextWeek) ? nextWeek : null;
  }
  await db
    .update(coachPlans)
    .set({
      progression,
      updatedAt: new Date(),
      ...(requestedFrom ? { requestedFrom } : {}),
    })
    .where(eq(coachPlans.userId, userId));
  logger.info("coach_plan.progression_saved", { rewrite: requestedFrom != null });
  return currentState(userId);
}

export async function saveBrief(userId: string, brief: string, expected?: string) {
  const [saved] = await db
    .update(coachPlans)
    .set({ brief, updatedAt: new Date() })
    .where(
      and(
        eq(coachPlans.userId, userId),
        ...(expected === undefined ? [] : [eq(coachPlans.brief, expected)]),
      ),
    )
    .returning({ userId: coachPlans.userId });
  logger.info("coach_plan.brief_saved", { saved: saved != null, length: brief.length });
  return saved != null;
}

export async function saveBriefImpl(brief: string): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  if (!(await saveBrief(userId, brief))) throw new Error("Set your availability first.");
  return currentState(userId);
}

export async function startCoachPlanIfDue(userId: string) {
  await startIfDue(userId, await gather(userId));
}

export async function writeCoachPlanAgainImpl(): Promise<CoachPlanState> {
  const session = await getRequiredSession();
  return currentState(session.user.id, { force: true });
}

export async function requestCoachPlanRewrite(userId: string) {
  const row = await readRow(userId);
  if (!row) return;
  await db
    .update(coachPlans)
    .set({ requestedFrom: dayKey(new Date(), row.timeZone), updatedAt: new Date() })
    .where(eq(coachPlans.userId, userId));
}

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
  const [saved] = await db
    .update(coachPlans)
    .set({ plan: next, updatedAt: new Date() })
    .where(and(eq(coachPlans.userId, userId), noActiveWriter(inputs.now)))
    .returning();
  if (!saved) throw new Error("Your plan is being written again: mark it once it's written.");
  logger.info("coach_plan.session_marked", { done });
  return stateOf({ ...inputs, plan: next }, saved);
}
