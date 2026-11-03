import { createHash } from "node:crypto";

import { chat } from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { weekCoach } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import { coachModelFor, type CoachModel } from "./coach-model.server.ts";
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

/** The mock coach reads a note without changing the week, so the flow runs with no key. */
const MOCK_READING: CoachReading = {
  constraints: [],
  note: "This is the mock coach: no model key is set, so your note was read without changing the week.",
};

/** Only adding or retrying a note reads it, so opening the week never spends the athlete's credit. */
async function notesModel(userId: string) {
  return coachModelFor(userId, "notes");
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
    anchor: data.season.anchor.map((goal) => [goal.id, goal.date, goal.priority]),
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
            priority: phase.priority,
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

/** The coach's reading, or why there is none, said so the athlete can act on it. */
async function askCoach(coach: CoachModel, prompt: unknown): Promise<CoachReading | string> {
  if (coach.kind === "missing") return "Missing openrouter API key";
  if (coach.kind === "mock") return MOCK_READING;
  try {
    return (await chat({
      adapter: coach.adapter,
      // Each reading stands alone: no conversation carries over between notes.
      threadId: crypto.randomUUID(),
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: "user", content: JSON.stringify(prompt) }],
      outputSchema: coachReadingSchema,
    })) as CoachReading;
  } catch (error) {
    // The athlete's key must never reach a log or the screen, even inside a provider's error.
    const message = scrubSecrets(error instanceof Error ? error.message : String(error), [
      coach.key,
    ]);
    logger.warn("week_coach.failed", { model: coach.model, error: message });
    return message;
  }
}

/**
 * Plans the days after today with the algorithm. With a model, free-text notes still waiting are
 * read first, into the same constraints quick choices give; its note goes on the week. Without
 * one they wait, and the plan ignores them until they are read.
 */
async function makePlan(
  data: Planned,
  notes: CoachNote[],
  previous: WeekPlan | null,
  coach: CoachModel | null,
) {
  const summary = summarizeWeek(data);
  const constraintsOf = (list: CoachNote[]) => list.flatMap((note) => note.constraints);
  const draft = planWeek({ data, summary, constraints: constraintsOf(notes), previous });
  const unchanged = { plan: { ...draft, note: previous?.note ?? null }, notes, summary };
  if (!coach || !notes.some((note) => !note.parsed)) return { ...unchanged, error: null };
  const reading = await askCoach(coach, promptFor(data, summary, notes, draft));
  if (typeof reading === "string") return { ...unchanged, error: reading };
  const updated = withParsedConstraints(
    notes,
    acceptConstraints(reading.constraints, weekDates(data.weekStart)),
  );
  const plan = planWeek({ data, summary, constraints: constraintsOf(updated), previous });
  logger.info("week_coach.planned", { constraints: constraintsOf(updated).length });
  return { plan: { ...plan, note: reading.note }, notes: updated, summary, error: null };
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
    seasonChange: null,
    needsReview: false,
    notesError: null,
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
    seasonChange: await seasonChangeFor(session.user.id, data),
    needsReview: data.plan.goals == null,
    notesError: null,
  };
}

/**
 * Plans the rest of the week again when its inputs changed; otherwise returns what is stored.
 * Given the notes model, it also reads notes still waiting, even when nothing else changed.
 */
async function replanWeekWith(coach: CoachModel | null): Promise<WeekCoachState> {
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
    seasonChange,
    needsReview: data.plan.goals == null,
    notesError: null,
  };
  const unread = coach != null && row.notes.some((note) => !note.parsed);
  if (!unread && row.plan && row.inputKey === inputKeyOf(data, summary, row.notes, row.plan)) {
    return { ...base, notes: row.notes, plan: row.plan };
  }
  const made = await makePlan(data, row.notes, row.plan, coach);
  const inputKey = inputKeyOf(data, made.summary, made.notes, made.plan);
  await saveRow(userId, data.weekStart, { notes: made.notes, plan: made.plan, inputKey });
  return { ...base, notes: made.notes, plan: made.plan, notesError: made.error };
}

/** Never calls the model, so a page load or sync never spends the athlete's credit (ADR 0036). */
export async function replanWeekImpl(): Promise<WeekCoachState> {
  return replanWeekWith(null);
}

/** Reads the notes still waiting with the athlete's key: the Retry on a note not read yet. */
export async function readCoachNotesImpl(): Promise<WeekCoachState> {
  const session = await getRequiredSession();
  return replanWeekWith(await notesModel(session.user.id));
}

export async function addCoachNoteImpl(input: CoachNoteInput): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const row = await readRow(session.user.id, data.weekStart);
  const notes = [...row.notes, noteFrom(input, crypto.randomUUID())];
  await saveRow(session.user.id, data.weekStart, { ...row, notes });
  logger.info("week_coach.note_added", { kind: input.kind, text: input.text.length > 0 });
  return replanWeekWith(input.text ? await notesModel(session.user.id) : null);
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
