import { createHash, randomUUID } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { coachPlanProposals, coachPlans } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { checkPlan, type RuleBreak, type RuleContext } from "./coach-plan-rules.ts";
import { availabilityText, paceText, rulesFor } from "./coach-plan-writer.server.ts";
import { firstDay, gather, matchOf, rangesOf, statusOf, type Inputs } from "./coach-plan.server.ts";
import {
  plannedRun,
  sessionLines,
  stepSecPerKm,
  type CoachPlan,
  type PlannedRun,
} from "./coach-plan.types.ts";
import type {
  ChangeSide,
  ChangedDay,
  PlanChangeApplied,
  PlanChangeInput,
  PlanChangeProposal,
} from "./coach-plan-change.ts";
import { addDayKey } from "./day-key.ts";
import { PHASES } from "./season-phase.ts";

/** A proposal the athlete hasn't applied within this long is gone; the coach proposes again. */
const PROPOSAL_TTL_MS = 60 * 60_000;

const STALE =
  "Your plan changed since the coach proposed this, so nothing was changed. Ask the coach again.";

const WRITING =
  "The coach plan is being written again right now, so nothing was changed. Ask again once it's written.";

type StoredChange = { dates: string[]; sessions: PlannedRun[]; days: ChangedDay[] };

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
    return "The coach plan isn't written yet. The athlete sets it up and writes it from This week.";
  }
  // A rewrite would replace the days the change was checked against.
  if (statusOf(inputs.row, inputs.now).status === "writing") return WRITING;
  return null;
}

/** The written weeks from this one on: what a change may touch. */
const weeksAhead = (inputs: Inputs, plan: CoachPlan) =>
  plan.weeks.filter((week) => week.weekStart >= inputs.currentWeek);

/**
 * The rule context for checking the plan ahead: the weeks from this one with their budgets, the
 * days before the first open one kept, and no floor, since a change may leave a week shorter
 * (ADR 0038).
 */
function changeContext(inputs: Inputs, plan: CoachPlan): RuleContext {
  const weeks = weeksAhead(inputs, plan);
  const sessions = weeks.flatMap((week) => week.sessions);
  const from = firstDay(inputs);
  return {
    availability: inputs.availability!,
    weeks: weeks.map(({ sessions: _sessions, ...budget }) => budget),
    from,
    today: inputs.today,
    frozen: sessions.filter((session) => session.kind !== "race" && session.date < from),
    runs: inputs.runs,
    raceDays: sessions.filter((session) => session.kind === "race").map((session) => session.date),
    neighbours: plan.weeks
      .filter((week) => week.weekStart < inputs.currentWeek)
      .flatMap((week) => week.sessions)
      .filter((session) => session.date >= addDayKey(inputs.today, -1)),
    easySecPerKm: stepSecPerKm(
      { part: "work", distanceM: 1000, durationS: null, pace: null, effort: "easy" },
      rangesOf(inputs),
    ),
    allowShort: true,
  };
}

/** The open runs ahead, from the first open day on: what the checker reads as written. */
const openRuns = (plan: CoachPlan, ctx: RuleContext) =>
  plan.weeks
    .flatMap((week) => week.sessions)
    .filter(
      (session) =>
        session.kind !== "race" &&
        session.date >= ctx.from &&
        ctx.weeks.some((week) => session.date >= week.weekStart),
    );

/** A break by rule and the day or week it names, so the same break before and after matches. */
const breakKey = (item: RuleBreak) =>
  `${item.rule}|${/\d{4}-\d{2}-\d{2}/.exec(item.message)?.[0] ?? ""}`;

/**
 * The breaks the change brings: every rule is checked over the whole plan ahead, before and after,
 * so a change that breaks a rule on a day it doesn't touch (a shorter long run lowering the next
 * week's longest-run limit, a dropped run raising the long run's share) is caught, while a break
 * the plan already had doesn't block an unrelated change.
 */
function newBreaks(before: PlannedRun[], after: PlannedRun[], ctx: RuleContext) {
  const had = new Set(checkPlan(before, ctx).map(breakKey));
  return checkPlan(after, ctx).filter((item) => !had.has(breakKey(item)));
}

const sideOf = (session: PlannedRun | undefined): ChangeSide =>
  session
    ? {
        title: session.title,
        kind: session.kind,
        key: session.key,
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
  const done = matchOf(inputs);
  return {
    canChange: true,
    today: inputs.today,
    firstChangeableDay: ctx.from,
    availability: availabilityText(ctx),
    paces: paceText(rangesOf(inputs)),
    weeks: weeksAhead(inputs, plan).map((week) => ({
      weekStart: week.weekStart,
      phase: PHASES[week.phase].label,
      lighter: week.lighter,
      taper: week.taper,
      budgetKm: week.budgetKm,
      sessions: week.sessions.map((session) => ({
        date: session.date,
        weekday: new Date(`${session.date}T12:00:00Z`).toLocaleDateString("en-GB", {
          weekday: "long",
          timeZone: "UTC",
        }),
        status: done.has(session.id) ? "done" : session.date < inputs.today ? "missed" : "planned",
        kind: session.kind,
        key: session.key,
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
      "A change may leave a week under 90 % of its budget: less running is fine when the athlete is ill, away, or tired.",
    ],
  };
}

/**
 * Checks the changed days against every rule and the athlete's availability. A change that passes
 * is stored for apply_plan_change; one that doesn't goes back to the coach with the rules it breaks.
 */
export async function proposePlanChange(
  userId: string,
  input: PlanChangeInput,
): Promise<PlanChangeProposal | { ok: false; message: string }> {
  const inputs = await gather(userId);
  const blocked = blocker(inputs);
  if (blocked) return { ok: false, message: blocked };
  const plan = inputs.plan!;
  const dates = input.days.map((day) => day.date);
  const changed = new Set(dates);
  const ctx = changeContext(inputs, plan);
  const last = addDayKey(ctx.weeks.at(-1)!.weekStart, 6);
  const broken: string[] = [];
  if (changed.size !== dates.length) broken.push("dates: list each day once.");
  for (const date of changed) {
    if (date < ctx.from || date > last) {
      broken.push(`dates: ${date} can't change. Change days from ${ctx.from} to ${last} only.`);
    } else if (ctx.raceDays.includes(date)) {
      broken.push(`dates: ${date} is a race day. Races follow the athlete's season.`);
    }
  }
  const before = new Map(
    weeksAhead(inputs, plan)
      .flatMap((week) => week.sessions)
      .map((session) => [session.date, session]),
  );
  const ranges = rangesOf(inputs);
  const sessions = input.days.flatMap((day) =>
    day.session ? [plannedRun({ ...day.session, date: day.date }, ranges)] : [],
  );
  const days = input.days
    .map((day) => ({
      date: day.date,
      before: sideOf(before.get(day.date)),
      after: sideOf(sessions.find((session) => session.date === day.date)),
    }))
    .filter((day) => JSON.stringify(day.before) !== JSON.stringify(day.after))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length && !broken.length) broken.push("change: these days are already planned so.");
  if (!broken.length) {
    const open = openRuns(plan, ctx);
    const after = [...open.filter((session) => !changed.has(session.date)), ...sessions];
    broken.push(...newBreaks(open, after, ctx).map((item) => `${item.rule}: ${item.message}`));
  }
  logger.info("coach_plan.change_checked", { days: dates.length, broken: broken.length });
  if (broken.length) return { ok: false, broken };

  const proposalId = randomUUID();
  const change: StoredChange = { dates, sessions, days };
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
  return { ok: true, proposalId, summary: input.summary, days };
}

/**
 * Saves a checked change the athlete applied, only onto the plan it was checked against: if the
 * plan changed since (a rewrite, another change applied, a day gone by), nothing is saved.
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
  if (change.dates.some((date) => date < firstDay(inputs)))
    return { applied: false, reason: STALE };

  const changed = new Set(change.dates);
  const refused = await db.transaction(async (tx) => {
    // Locked, so a rewrite can't claim the plan between this check and the save.
    const [row] = await tx
      .select()
      .from(coachPlans)
      .where(eq(coachPlans.userId, userId))
      .for("update");
    if (!row?.plan || planKeyOf(row.plan) !== proposal.planKey) return STALE;
    if (statusOf(row, new Date()).status === "writing") return WRITING;
    const plan = row.plan as CoachPlan;
    const next: CoachPlan = {
      ...plan,
      weeks: plan.weeks.map((week) => ({
        ...week,
        sessions: [
          ...week.sessions.filter((session) => !changed.has(session.date)),
          ...change.sessions.filter(
            (session) =>
              session.date >= week.weekStart && session.date <= addDayKey(week.weekStart, 6),
          ),
        ].sort((a, b) => a.date.localeCompare(b.date)),
      })),
    };
    await tx
      .update(coachPlans)
      .set({ plan: next, updatedAt: new Date() })
      .where(eq(coachPlans.userId, userId));
    // Every other proposal was checked against the plan as it was.
    await tx.delete(coachPlanProposals).where(eq(coachPlanProposals.userId, userId));
    return null;
  });
  logger.info("coach_plan.change_applied", { applied: refused == null, days: change.dates.length });
  return refused == null ? { applied: true } : { applied: false, reason: refused };
}
