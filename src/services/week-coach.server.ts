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
import { PHASES } from "./season-phase.ts";
import { addDayKey, keySessionName, type TrainingPlan } from "./training-plan.types.ts";
import {
  acceptConstraints,
  acceptProposedPlan,
  noteFrom,
  planDates,
  planWeek,
  proposedPlanSchema,
  withParsedConstraints,
  type CoachNote,
  type CoachNoteInput,
  type ProposedPlan,
  type WeekCoachState,
  type WeekPlan,
} from "./week-plan.ts";
import { loadWeekTargetImpl } from "./week-target.server.ts";
import { summarizeWeek, type WeekSummary, type WeekTargetData } from "./week-target.ts";

const SYSTEM_PROMPT = `You are an endurance coach arranging the rest of one training week for an athlete. VO2's planner has already decided how much to train, which key sessions are left, and a default day-by-day layout. You read what the athlete says about their days, then rearrange the layout around it and their goal. Never invent key sessions, races, or extra volume; use only the ids you are given. Answer only with the requested JSON.`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Planned = WeekTargetData & { plan: TrainingPlan };

/** The coach model, or null without an API key: the algorithm's layout then stands. */
function adapter() {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createOpenRouterText(ANALYSIS_MODEL, apiKey, {
    httpReferer: env.BETTER_AUTH_URL,
    appTitle: APP_NAME,
  });
}

/** What a plan is made from; when it changes, the stored plan is stale. */
function inputKeyOf(data: Planned, notes: CoachNote[]) {
  const parts = {
    today: data.today,
    activities: data.activities.map((activity) => [activity.id, activity.minutes]),
    notes: notes.map((note) => [note.id, note.parsed]),
    phase: [data.season.kind, data.season.lighter, data.season.anchor.map((goal) => goal.id)],
    pinned: data.plan.keySessionSports,
    mix: data.plan.weekMix,
    mode: [data.plan.targetMode, data.plan.targetWeeklyHours, data.plan.preferredRestWeekday],
  };
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

async function readRow(userId: string, weekStart: string) {
  const [row] = await db
    .select()
    .from(weekCoach)
    .where(and(eq(weekCoach.userId, userId), eq(weekCoach.weekStart, weekStart)))
    .limit(1);
  return row
    ? {
        notes: (row.notes as CoachNote[]) ?? [],
        plan: (row.plan as WeekPlan | null) ?? null,
        inputKey: row.inputKey,
      }
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

function promptFor(data: Planned, summary: WeekSummary, notes: CoachNote[], base: WeekPlan) {
  const phase = data.season;
  const dayName = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return {
    task: [
      "Rearrange the rest of this week around what the athlete says and what their goal needs.",
      "1. Read every athlete note into constraints: off (cannot train that day), short (minutes = time they have), indoor (trainer or treadmill only), easy (tired, sore, sick or stressed). Resolve words like 'today', 'tomorrow', 'this weekend' with the dates given. Return every constraint you read, also those already listed.",
      "2. Return one entry per date in algorithmPlan, keeping race days and the opener as they are. You may move key sessions between days, swap sports, shorten or lengthen easy days, and turn a day to rest.",
      "Rules: use each open key session id at most once and only those ids; never put two hard key sessions on consecutive days (nor the day after a hard day already done); a day with an 'off' constraint is rest; an 'easy' day has no key session; a 'short' day fits its minutes; indoor days set indoor true; keep the week's total time within the remaining minutes (10% leeway); easy days are at least 45 min riding or 30 min running.",
      "Use the time the athlete has: while the week still has minutes left, put them on days the athlete can train (a 40-minute trainer ride beats a rest day). Prefer the long session on the day with the most time, keep sessions on the goal's sport when the phase calls for it, and if a key session no longer fits anywhere leave it out rather than squeezing it; turn its time into easy time on the days that are left.",
      "note: 2 to 3 sentences to the athlete in plain words: what changed and why, tied to their goal. No numbers they can already see, no medical advice.",
    ],
    today: `${data.today} (${dayName(data.today)})`,
    dates: base.days.map((day) => `${day.date} (${dayName(day.date)})`),
    phase: {
      kind: PHASES[phase.kind].label,
      lighterWeek: phase.lighter,
      goal: phase.anchor.length
        ? {
            name: phase.anchor.map((goal) => goal.name).join(" + "),
            date: phase.anchor[0]!.date,
            priority: phase.anchor[0]!.priority,
            objective: phase.objective,
            distanceKm: phase.anchor.map((goal) =>
              goal.distanceM == null ? null : Math.round(goal.distanceM / 100) / 10,
            ),
            elevationGainM: phase.anchor.map((goal) => goal.elevationGainM),
          }
        : null,
      goalSport: phase.sessions?.keySport ?? null,
    },
    week: {
      targetMinutes: summary.target.minutes,
      doneMinutes: summary.doneMinutes,
      remainingMinutes: summary.remainingMinutes,
      form: Math.round(summary.form),
      keySessionsPaused: summary.paused,
      leftBySport: {
        riding: summary.bySport.cycling.left,
        running: summary.bySport.running.left,
        other: summary.bySport.other.left,
      },
    },
    openKeySessions: summary.keySessions
      .filter((status) => !status.done && !status.skipped)
      .map((status) => ({
        id: status.session.id,
        name: keySessionName(status.session),
        minutes: status.minutes,
        sport: status.session.sport,
        hard: status.session.kind !== "long" && status.session.zone !== "z2",
      })),
    doneThisWeek: data.activities.map((activity) => ({
      date: activity.date,
      title: activity.title,
      sportType: activity.sportType,
      minutes: activity.minutes,
      hardMinutes: activity.hardMinutes,
    })),
    athleteNotes: notes.map((note) => ({
      writtenOn: note.createdAt.slice(0, 10),
      about: note.date,
      text: note.text,
      constraints: note.constraints,
    })),
    algorithmPlan: base.days,
  };
}

async function askCoach(prompt: unknown): Promise<ProposedPlan | null> {
  const model = adapter();
  if (!model) return null;
  try {
    return (await chat({
      adapter: model,
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: "user", content: JSON.stringify(prompt) }],
      outputSchema: proposedPlanSchema,
    })) as ProposedPlan;
  } catch (error) {
    logger.warn("week_coach.failed", { error: String(error) });
    return null;
  }
}

/**
 * Lays the week out with the algorithm, then lets the model rearrange it around the athlete's
 * notes. Constraints the model reads are kept on the notes; a layout breaking any rule is
 * dropped for the algorithm's layout with those constraints.
 */
async function makePlan(data: Planned, notes: CoachNote[]) {
  const summary = summarizeWeek(data);
  const dates = planDates(data);
  const constraintsOf = (list: CoachNote[]) => list.flatMap((note) => note.constraints);
  const first = planWeek(data, summary, constraintsOf(notes));
  const raw = await askCoach(promptFor(data, summary, notes, first));
  if (!raw) return { plan: first, notes };

  const updated = withParsedConstraints(notes, acceptConstraints(raw.constraints, dates));
  const constraints = constraintsOf(updated);
  const base = planWeek(data, summary, constraints);
  const openKeys = new Map(
    summary.keySessions
      .filter((status) => !status.done && !status.skipped && !summary.paused)
      .map((status) => [status.session.id, status.session]),
  );
  const firstDate = base.days[0]?.date;
  const hardBefore = data.activities.some(
    (activity) =>
      firstDate != null && activity.date === addDayKey(firstDate, -1) && activity.hardMinutes >= 15,
  );
  const { plan, problems } = acceptProposedPlan(raw, {
    base,
    constraints,
    openKeys,
    remainingMinutes: summary.remainingMinutes,
    hardBefore,
  });
  logger.info("week_coach.planned", {
    accepted: plan != null,
    problems: problems.slice(0, 5),
    constraints: constraints.length,
  });
  // A rejected layout keeps the model's reading of the notes, not its words about a layout
  // the athlete won't see.
  return { plan: plan ?? base, notes: updated };
}

function emptyState(weekStart: string): WeekCoachState {
  return { weekStart, notes: [], plan: null, stale: false, aiAvailable: adapter() != null };
}

async function plannedWeek() {
  const data = await loadWeekTargetImpl();
  if (!data.signedIn || !data.plan) return null;
  return data as Planned;
}

/** The stored plan, or the algorithm's while none is stored. Never calls the model. */
export async function loadWeekCoachImpl(): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const row = await readRow(session.user.id, data.weekStart);
  const key = inputKeyOf(data, row.notes);
  const aiAvailable = adapter() != null;
  const plan =
    row.plan ??
    planWeek(
      data,
      summarizeWeek(data),
      row.notes.flatMap((n) => n.constraints),
    );
  return {
    weekStart: data.weekStart,
    notes: row.notes,
    plan,
    stale: row.inputKey !== key && (aiAvailable || row.plan != null),
    aiAvailable,
  };
}

/** Re-plans when a sync or a note changed the inputs; otherwise returns what is stored. */
export async function replanWeekImpl(): Promise<WeekCoachState> {
  const data = await plannedWeek();
  if (!data) return emptyState("");
  const session = await getRequiredSession();
  const userId = session.user.id;
  const row = await readRow(userId, data.weekStart);
  const key = inputKeyOf(data, row.notes);
  if (row.plan && row.inputKey === key) {
    return {
      weekStart: data.weekStart,
      notes: row.notes,
      plan: row.plan,
      stale: false,
      aiAvailable: adapter() != null,
    };
  }
  const made = await makePlan(data, row.notes);
  const inputKey = inputKeyOf(data, made.notes);
  await saveRow(userId, data.weekStart, { notes: made.notes, plan: made.plan, inputKey });
  return {
    weekStart: data.weekStart,
    notes: made.notes,
    plan: made.plan,
    stale: false,
    aiAvailable: adapter() != null,
  };
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
