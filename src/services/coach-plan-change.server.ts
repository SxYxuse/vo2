import { createHash, randomUUID } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { coachPlanProposals, coachPlans } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import {
  checkPlan,
  raceWeeks,
  sessionsAvailable,
  type RuleBreak,
  type RuleContext,
} from "./coach-plan-rules.ts";
import { availabilityText, paceText, rulesFor, zoneText } from "./coach-plan-writer.server.ts";
import { anchorsOf, gather, rangesOf, statusOf, type Inputs } from "./coach-plan.server.ts";
import {
  PLAN_SPORTS,
  plannedSession,
  readCoachPlan,
  sessionLines,
  stepSecPerKm,
  type CoachPlan,
  type PlanSport,
  type PlanWeek,
  type PlannedSession,
} from "./coach-plan.types.ts";
import type { WeekBudget } from "./coach-plan-budget.ts";
import { addDayKey } from "./day-key.ts";
import type {
  ChangeSide,
  ChangedSession,
  PlanChangeApplied,
  PlanChangeInput,
  PlanChangeProposal,
} from "./coach-plan-change.ts";
import { PHASES } from "./season-phase.ts";

/** A proposal the athlete hasn't applied within this long is gone; the coach proposes again. */
const PROPOSAL_TTL_MS = 60 * 60_000;

const STALE =
  "Your plan changed since the coach proposed this, so nothing was changed. Ask the coach again.";

const WRITING =
  "The coach plan is being written again right now, so nothing was changed. Ask again once it's written.";

/**
 * A checked change: the ids of the sessions it replaces or drops, the sessions after it (a
 * replacement keeps its id), and the change as the athlete sees it.
 */
type StoredChange = { ids: string[]; sessions: PlannedSession[]; changes: ChangedSession[] };

/** The plan as read from the database, hashed: a proposal applies only onto the same plan. */
const planKeyOf = (plan: unknown) =>
  createHash("sha1")
    .update(JSON.stringify(plan ?? null))
    .digest("hex");

/** Why the plan can't be changed now, in words the coach passes on, or null when it can. */
function blocker(inputs: Inputs): string | null {
  if (inputs.style !== "coachPlan") {
    return "The athlete doesn't follow the coach plan, so there is no plan to change.";
  }
  if (!inputs.plan || !inputs.availability) {
    return "The coach plan isn't written yet. The athlete sets it up and writes it from Plan.";
  }
  // A rewrite would replace the sessions the change was checked against.
  if (statusOf(inputs.row, inputs.now).status === "writing") return WRITING;
  return null;
}

/** A written week's budgets, as the rules read them; weeks written before rides have none. */
const budgetOf = ({ sessions: _sessions, ...week }: PlanWeek): WeekBudget => ({
  ...week,
  budgetMinutes: week.budgetMinutes ?? 0,
});

/** The written weeks from this one on: what a change may touch. */
const weeksAhead = (inputs: Inputs, plan: CoachPlan) =>
  plan.weeks.filter((week) => week.weekStart >= inputs.currentWeek);

/**
 * The rule context for checking the plan ahead: the weeks from this one with their budgets, the
 * sessions marked done kept, and no floor, since a change may leave a week shorter (ADR 0038).
 */
function changeContext(inputs: Inputs, plan: CoachPlan): RuleContext {
  const weeks = weeksAhead(inputs, plan);
  const sessions = weeks.flatMap((week) => week.sessions);
  return {
    availability: inputs.availability!,
    weeks: weeks.map(budgetOf),
    fromWeek: inputs.currentWeek,
    today: inputs.today,
    frozen: sessions.filter((session) => session.kind !== "race" && session.done),
    runs: inputs.runs,
    rides: inputs.rides,
    races: raceWeeks(
      inputs.goals,
      inputs.currentWeek,
      addDayKey(weeks.at(-1)?.weekStart ?? inputs.currentWeek, 6),
    ).map(({ race }) => race),
    neighbours: [],
    easySecPerKm: stepSecPerKm(
      { part: "work", distanceM: 1000, durationS: null, pace: null, zone: null, effort: "easy" },
      rangesOf(inputs),
    ),
    allowShort: true,
  };
}

/** The open runs ahead: what the checker reads as written. */
const openRuns = (plan: CoachPlan, ctx: RuleContext) =>
  plan.weeks
    .flatMap((week) => week.sessions)
    .filter(
      (session) =>
        session.kind !== "race" &&
        !session.done &&
        ctx.weeks.some((week) => week.weekStart === session.weekStart),
    );

/** The week a break names: every break names its week first. */
const breakWeek = (item: RuleBreak) => /\d{4}-\d{2}-\d{2}/.exec(item.message)?.[0] ?? "";
const breakKey = (item: RuleBreak) => `${item.rule}|${breakWeek(item)}`;

/**
 * The breaks the change brings: every rule is checked over the whole plan ahead, before and after,
 * so a change that breaks a rule in a week it doesn't touch (a shorter long run lowering the next
 * week's longest-run limit) is caught, while a break the plan already had elsewhere doesn't block
 * an unrelated change. A break in a changed week always counts: the change could have made it
 * worse.
 */
function newBreaks(
  before: PlannedSession[],
  after: PlannedSession[],
  changed: Set<string>,
  ctx: RuleContext,
) {
  const longestBefore: Partial<Record<PlanSport, Record<string, number>>> = {};
  for (const { id: sport } of PLAN_SPORTS) {
    const byWeek: Record<string, number> = {};
    for (const week of ctx.weeks) {
      byWeek[week.weekStart] = Math.max(
        0,
        ...[...ctx.frozen, ...before]
          .filter((session) => session.weekStart === week.weekStart && session.sport === sport)
          .map((session) => (sport === "run" ? session.distanceKm : session.minutes)),
      );
    }
    longestBefore[sport] = byWeek;
  }
  const checked = { ...ctx, longestBefore };
  const had = new Set(checkPlan(before, checked).map(breakKey));
  return checkPlan(after, checked).filter(
    (item) => changed.has(breakWeek(item)) || !had.has(breakKey(item)),
  );
}

const sideOf = (session: PlannedSession | undefined): ChangeSide =>
  session
    ? {
        title: session.title,
        sport: session.sport,
        kind: session.kind,
        distanceKm: session.distanceKm,
        minutes: session.minutes,
        steps: sessionLines(session),
      }
    : null;

/** The coach plan as the chat coach reads it: the weeks ahead, the rules, and what can change. */
export async function coachPlanForCoach(userId: string) {
  const inputs = await gather(userId);
  const blocked = blocker(inputs);
  if (blocked) return { canChange: false, message: blocked };
  const plan = inputs.plan!;
  const ctx = changeContext(inputs, plan);
  return {
    canChange: true,
    today: inputs.today,
    availability: availabilityText(ctx),
    paces: paceText(rangesOf(inputs)),
    rideZones: zoneText(anchorsOf(inputs)),
    weeks: weeksAhead(inputs, plan).map((week) => ({
      weekStart: week.weekStart,
      phase: PHASES[week.phase].label,
      lighter: week.lighter,
      taper: week.taper,
      budgetKm: week.budgetKm,
      budgetMinutes: week.budgetMinutes ?? 0,
      runs: sessionsAvailable(budgetOf(week), ctx, "run"),
      rides: sessionsAvailable(budgetOf(week), ctx, "ride"),
      sessions: week.sessions.map((session) => ({
        id: session.id,
        status: session.done ? "done" : "open",
        sport: session.sport,
        kind: session.kind,
        title: session.title,
        why: session.why,
        distanceKm: session.distanceKm,
        minutes: session.minutes,
        blocks: session.blocks.map((block) => ({
          repeat: block.repeat,
          steps: block.steps.map(({ range: _range, ...step }) => step),
        })),
      })),
    })),
    rules: [
      ...rulesFor(ctx),
      "A change may leave a week under 90 % of its budgets: less training is fine when the athlete is ill, away, or tired.",
      "Sessions marked done and races can't change.",
    ],
  };
}

/**
 * Checks the changed sessions against every rule and the athlete's availability. A change that
 * passes is stored for apply_plan_change; one that doesn't goes back to the coach with the rules
 * it breaks.
 */
export async function proposePlanChange(
  userId: string,
  input: PlanChangeInput,
): Promise<PlanChangeProposal | { ok: false; message: string }> {
  const inputs = await gather(userId);
  const blocked = blocker(inputs);
  if (blocked) return { ok: false, message: blocked };
  const plan = inputs.plan!;
  const ctx = changeContext(inputs, plan);
  const byId = new Map(
    weeksAhead(inputs, plan)
      .flatMap((week) => week.sessions)
      .map((session) => [session.id, session]),
  );
  const ids = input.sessions.flatMap((change) => (change.id ? [change.id] : []));
  const broken: string[] = [];
  if (new Set(ids).size !== ids.length) broken.push("sessions: list each session once.");
  const anchors = anchorsOf(inputs);
  const sessions: PlannedSession[] = [];
  const changes: ChangedSession[] = [];
  for (const change of input.sessions) {
    const before = change.id ? byId.get(change.id) : undefined;
    if (change.id && !before) {
      broken.push(`sessions: ${change.id} isn't a session from this week on. Use get_coach_plan.`);
    } else if (before?.done || before?.kind === "race") {
      broken.push(`sessions: "${before.title}" is ${before.done ? "done" : "a race"}.`);
    } else if (before || change.session) {
      // A session changed stays in its week and its sport.
      const weekStart = before?.weekStart ?? change.session!.weekStart;
      const sport = before?.sport ?? change.session!.sport;
      const after = change.session
        ? plannedSession({ ...change.session, weekStart, sport }, anchors, before?.id)
        : undefined;
      if (after) sessions.push(after);
      if (JSON.stringify(sideOf(before)) !== JSON.stringify(sideOf(after))) {
        changes.push({ weekStart, before: sideOf(before), after: sideOf(after) });
      }
    }
  }
  if (!changes.length && !broken.length) broken.push("change: these sessions are already so.");
  if (!broken.length) {
    const open = openRuns(plan, ctx);
    const replaced = new Set(ids);
    const after = [...open.filter((session) => !replaced.has(session.id)), ...sessions];
    const weeks = new Set(changes.map((change) => change.weekStart));
    broken.push(
      ...newBreaks(open, after, weeks, ctx).map((item) => `${item.rule}: ${item.message}`),
    );
  }
  logger.info("coach_plan.change_checked", {
    sessions: input.sessions.length,
    broken: broken.length,
  });
  if (broken.length) return { ok: false, broken };

  changes.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const proposalId = randomUUID();
  const change: StoredChange = { ids, sessions, changes };
  await db
    .delete(coachPlanProposals)
    .where(
      and(
        eq(coachPlanProposals.userId, userId),
        lt(coachPlanProposals.createdAt, new Date(Date.now() - PROPOSAL_TTL_MS)),
      ),
    );
  await db
    .insert(coachPlanProposals)
    .values({ id: proposalId, userId, planKey: planKeyOf(inputs.row?.plan), change });
  return { ok: true, proposalId, summary: input.summary, sessions: changes };
}

/** The plan with a change applied: replaced sessions in their place, added ones at the end. */
function applied(plan: CoachPlan, change: StoredChange): CoachPlan {
  const removed = new Set(change.ids);
  const byId = new Map(change.sessions.map((session) => [session.id, session]));
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      sessions: [
        ...week.sessions.flatMap((session) => {
          if (!removed.has(session.id)) return [session];
          const replacement = byId.get(session.id);
          return replacement ? [replacement] : [];
        }),
        ...change.sessions.filter(
          (session) => session.weekStart === week.weekStart && !removed.has(session.id),
        ),
      ],
    })),
  };
}

/**
 * Saves a checked change the athlete applied, only onto the plan it was checked against: if the
 * plan changed since (a rewrite, another change applied, a session marked done, a week gone by),
 * nothing is saved.
 */
export async function applyPlanChange(
  userId: string,
  proposalId: string,
): Promise<PlanChangeApplied> {
  const [proposal] = await db
    .select()
    .from(coachPlanProposals)
    .where(and(eq(coachPlanProposals.id, proposalId), eq(coachPlanProposals.userId, userId)))
    .limit(1);
  if (!proposal || Date.now() - proposal.createdAt.getTime() > PROPOSAL_TTL_MS) {
    return { applied: false, reason: "This change is no longer offered. Ask the coach again." };
  }
  const change = proposal.change as StoredChange;
  const inputs = await gather(userId);
  const blocked = blocker(inputs);
  if (blocked) return { applied: false, reason: blocked };
  if (change.changes.some((item) => item.weekStart < inputs.currentWeek)) {
    return { applied: false, reason: STALE };
  }

  const refused = await db.transaction(async (tx) => {
    // Locked, so a rewrite can't claim the plan between this check and the save.
    const [row] = await tx
      .select()
      .from(coachPlans)
      .where(eq(coachPlans.userId, userId))
      .for("update");
    if (!row?.plan || planKeyOf(row.plan) !== proposal.planKey) return STALE;
    if (statusOf(row, new Date()).status === "writing") return WRITING;
    await tx
      .update(coachPlans)
      .set({ plan: applied(readCoachPlan(row.plan)!, change), updatedAt: new Date() })
      .where(eq(coachPlans.userId, userId));
    // Every other proposal was checked against the plan as it was.
    await tx.delete(coachPlanProposals).where(eq(coachPlanProposals.userId, userId));
    return null;
  });
  logger.info("coach_plan.change_applied", {
    applied: refused == null,
    sessions: change.changes.length,
  });
  return refused == null ? { applied: true } : { applied: false, reason: refused };
}
