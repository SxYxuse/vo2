import { createHash } from "node:crypto";

import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq } from "drizzle-orm";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import { weekCoach } from "@/db/schema.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import { ANALYSIS_MODEL } from "./activity-analysis.server.ts";
import { planGoalsFrom } from "./plan-builder.types.ts";
import { adoptedNote, planImpact, type PlanImpact } from "./plan-impact.ts";
import { PHASES } from "./season-phase.ts";
import { goalsFor } from "./season.server.ts";
import type { Goal } from "./season.types.ts";
import { saveTrainingPlanForUser } from "./training-plan.server.ts";
import { keySessionName, trainingDayCount, type TrainingPlan } from "./training-plan.types.ts";
import {
  acceptConstraints,
  coachReadingSchema,
  isWeekPlan,
  noteFrom,
  planWeek,
  replanSignals,
  weekDates,
  withParsedConstraints,
  type CoachNote,
  type CoachNoteInput,
  type CoachReading,
  type WeekCoachState,
  type WeekPlan,
} from "./week-plan.ts";
import { loadWeekTargetImpl } from "./week-target.server.ts";
import { summarizeWeek, type WeekSummary, type WeekTargetData } from "./week-target.ts";

const SYSTEM_PROMPT = `You are an endurance coach reading what an athlete says about the days of one training week. VO2's planner lays the week out; you turn the athlete's words into day constraints and write a short note. Never invent sessions, races, or volume. Answer only with the requested JSON.`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Planned = WeekTargetData & { plan: TrainingPlan };

/** The coach model, or null without an API key: quick choices still plan the week. */
function adapter() {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createOpenRouterText(ANALYSIS_MODEL, apiKey, {
    httpReferer: env.BETTER_AUTH_URL,
    appTitle: APP_NAME,
  });
}

/**
 * What the days after today are planned from. Today itself is not part of it: the plan stays
 * put day to day, and changes only when a key session is done or missed, a note arrives, the
 * week's shape or goals change.
 */
function inputKeyOf(
  data: Planned,
  summary: WeekSummary,
  notes: CoachNote[],
  plan: WeekPlan | null,
) {
  const { plan: training } = data;
  const parts = {
    weekStart: data.weekStart,
    shape: [training.restWeekdays, training.longWeekday, training.doubleDays, training.sports],
    goals: [data.season.kind, data.season.lighter, data.nearbyGoals.map((goal) => goal.id)],
    anchor: data.season.anchor.map((goal) => [goal.id, goal.date, goal.objective]),
    target: summary.target.minutes,
    pinned: training.keySessionSports,
    paused: summary.paused,
    notes: notes.map((note) => [note.id, note.parsed, note.constraints.length]),
    ...replanSignals(plan, data, summary),
  };
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

async function readRow(userId: string, weekStart: string) {
  const [row] = await db
    .select()
    .from(weekCoach)
    .where(and(eq(weekCoach.userId, userId), eq(weekCoach.weekStart, weekStart)))
    .limit(1);
  const plan = row && isWeekPlan(row.plan, weekStart) ? row.plan : null;
  return row
    ? { notes: (row.notes as CoachNote[]) ?? [], plan, inputKey: row.inputKey }
    : { notes: [] as CoachNote[], plan: null, inputKey: null };
}

async function saveRow(
  userId: string,
  weekStart: string,
  values: { notes: CoachNote[]; plan: WeekPlan | null; inputKey: string | null },
) {
  await db
    .insert(weekCoach)
    .values({ userId, weekStart, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [weekCoach.userId, weekCoach.weekStart],
      set: { ...values, updatedAt: new Date() },
    });
}

/** Drops this week's stored plan so the next load plans the rest of the week again. */
export async function forgetWeekPlan(userId: string, weekStart: string) {
  await db
    .update(weekCoach)
    .set({ inputKey: null, updatedAt: new Date() })
    .where(and(eq(weekCoach.userId, userId), eq(weekCoach.weekStart, weekStart)));
}

function promptFor(data: Planned, summary: WeekSummary, notes: CoachNote[], plan: WeekPlan) {
  const phase = data.season;
  const dayName = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return {
    task: [
      "1. Read every athlete note into constraints: off (cannot train that day), short (minutes = time they have), indoor (trainer or treadmill only), easy (tired, sore, sick or stressed). Resolve words like 'today', 'tomorrow', 'this weekend' with the dates given. Return every constraint you read, also those already listed.",
      "2. note: 2 to 3 sentences to the athlete in plain words about how the week bends around what they said, tied to their goal. No numbers they can already see, no medical advice.",
    ],
    today: `${data.today} (${dayName(data.today)})`,
    dates: weekDates(data.weekStart).map((date) => `${date} (${dayName(date)})`),
    phase: {
      kind: PHASES[phase.kind].label,
      lighterWeek: phase.lighter,
      goal: phase.anchor.length
        ? {
            name: phase.anchor.map((goal) => goal.name).join(" + "),
            date: phase.anchor[0]!.date,
            priority: phase.anchor[0]!.priority,
            objective: phase.objective,
          }
        : null,
    },
    week: {
      targetMinutes: summary.target.minutes,
      doneMinutes: summary.doneMinutes,
      remainingMinutes: summary.remainingMinutes,
      form: Math.round(summary.form),
    },
    keySessions: summary.keySessions.map((status) => ({
      name: keySessionName(status.session),
      done: status.done != null,
    })),
    plannedDays: plan.days.map((day) => ({
      date: day.date,
      rest: day.rest,
      sessions: day.sessions.map((item) => `${item.kind} ${item.sport} ${item.minutes} min`),
    })),
    athleteNotes: notes.map((note) => ({
      writtenOn: note.createdAt.slice(0, 10),
      about: note.date,
      text: note.text,
      constraints: note.constraints,
    })),
  };
}

async function askCoach(prompt: unknown): Promise<CoachReading | null> {
  const model = adapter();
  if (!model) return null;
  try {
    return (await chat({
      adapter: model,
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: "user", content: JSON.stringify(prompt) }],
      outputSchema: coachReadingSchema,
    })) as CoachReading;
  } catch (error) {
    logger.warn("week_coach.failed", { error: String(error) });
    return null;
  }
}

/**
 * Plans the days after today with the algorithm. Free-text notes still waiting are read by the
 * model first, into the same constraints quick choices give; its note goes on the week.
 */
async function makePlan(data: Planned, notes: CoachNote[], previous: WeekPlan | null) {
  const summary = summarizeWeek(data);
  const constraintsOf = (list: CoachNote[]) => list.flatMap((note) => note.constraints);
  const draft = planWeek({ data, summary, constraints: constraintsOf(notes), previous });
  if (!notes.some((note) => !note.parsed)) {
    return { plan: { ...draft, note: previous?.note ?? null }, notes, summary };
  }
  const reading = await askCoach(promptFor(data, summary, notes, draft));
  if (!reading) return { plan: { ...draft, note: previous?.note ?? null }, notes, summary };
  const updated = withParsedConstraints(
    notes,
    acceptConstraints(reading.constraints, weekDates(data.weekStart)),
  );
  const plan = planWeek({ data, summary, constraints: constraintsOf(updated), previous });
  logger.info("week_coach.planned", { constraints: constraintsOf(updated).length });
  return { plan: { ...plan, note: reading.note }, notes: updated, summary };
}

async function plannedWeek() {
  const data = await loadWeekTargetImpl();
  if (!data.signedIn || !data.plan) return null;
  return data as Planned;
}

/**
 * Season against the plan's own goals. A change that reshapes no week of the current block goes
 * into the plan at once, with a note saying so; one that does waits for the athlete.
 */
export async function reconcileSeason(
  userId: string,
  plan: TrainingPlan,
  weekStart: string,
): Promise<{ impact: PlanImpact | null; adopted: string | null }> {
  if (!plan.goals) return { impact: null, adopted: null };
  const season = await goalsFor(userId);
  const impact = planImpact(plan.goals as Goal[], season, weekStart, trainingDayCount(plan));
  if (!impact.differs) return { impact: null, adopted: null };
  if (impact.changes.length) return { impact, adopted: null };
  await saveTrainingPlanForUser(userId, { ...plan, goals: planGoalsFrom(season) });
  logger.info("plan.season_adopted", { goals: season.length });
  return { impact: null, adopted: adoptedNote(season, weekStart) };
}

async function seasonChangeFor(userId: string, data: Planned) {
  return (await reconcileSeason(userId, data.plan, data.weekStart)).impact;
}

function emptyState(weekStart: string): WeekCoachState {
  return {
    weekStart,
    notes: [],
    plan: null,
    stale: false,
    aiAvailable: adapter() != null,
    seasonChange: null,
    needsReview: false,
  };
}

/** The stored week plan, or one planned now while none is stored. Never calls the model. */
export async function loadWeekCoachImpl(): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const row = await readRow(session.user.id, data.weekStart);
  const summary = summarizeWeek(data);
  const plan =
    row.plan ??
    planWeek({
      data,
      summary,
      constraints: row.notes.flatMap((note) => note.constraints),
      previous: null,
    });
  return {
    weekStart: data.weekStart,
    notes: row.notes,
    plan,
    stale: row.plan == null || row.inputKey !== inputKeyOf(data, summary, row.notes, row.plan),
    aiAvailable: adapter() != null,
    seasonChange: await seasonChangeFor(session.user.id, data),
    needsReview: data.plan.goals == null,
  };
}

/** Plans the rest of the week again when its inputs changed; otherwise returns what is stored. */
export async function replanWeekImpl(): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const userId = session.user.id;
  const row = await readRow(userId, data.weekStart);
  const seasonChange = await seasonChangeFor(userId, data);
  const summary = summarizeWeek(data);
  const base = {
    weekStart: data.weekStart,
    stale: false,
    aiAvailable: adapter() != null,
    seasonChange,
    needsReview: data.plan.goals == null,
  };
  if (row.plan && row.inputKey === inputKeyOf(data, summary, row.notes, row.plan)) {
    return { ...base, notes: row.notes, plan: row.plan };
  }
  const made = await makePlan(data, row.notes, row.plan);
  const inputKey = inputKeyOf(data, made.summary, made.notes, made.plan);
  await saveRow(userId, data.weekStart, { notes: made.notes, plan: made.plan, inputKey });
  return { ...base, notes: made.notes, plan: made.plan };
}

export async function addCoachNoteImpl(input: CoachNoteInput): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const row = await readRow(session.user.id, data.weekStart);
  const notes = [...row.notes, noteFrom(input, crypto.randomUUID())];
  await saveRow(session.user.id, data.weekStart, { ...row, notes });
  logger.info("week_coach.note_added", { kind: input.kind, text: input.text.length > 0 });
  return replanWeekImpl();
}

export async function removeCoachNoteImpl(id: string): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const row = await readRow(session.user.id, data.weekStart);
  const notes = row.notes.filter((note) => note.id !== id);
  await saveRow(session.user.id, data.weekStart, { ...row, notes });
  return replanWeekImpl();
}
