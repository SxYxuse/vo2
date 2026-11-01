import { chat, type ModelMessage } from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";

// Server-only: imported from handlers alone, so the coaching knowledge stays out of the app.
import paces from "@/coaching/running/paces.md?raw";
import principles from "@/coaching/running/principles.md?raw";
import sessions from "@/coaching/running/sessions.md?raw";
import { logger } from "@/lib/logger.server.ts";
import type { CoachModel } from "./coach-model.server.ts";
import { mockCoachPlan } from "./coach-plan-mock.ts";
import {
  checkPlan,
  MAX_LONG_MINUTES,
  maxLongShare,
  maxQualitySessions,
  type RuleBreak,
  type RuleContext,
} from "./coach-plan-rules.ts";
import {
  plannedRun,
  writtenPlanSchema,
  type PlannedRun,
  type WrittenPlan,
} from "./coach-plan.types.ts";
import { addDayKey } from "./day-key.ts";
import { formatPaceClock } from "./locomotion.ts";
import { PHASES } from "./season-phase.ts";
import type { PaceRange, PaceType } from "./training-paces.types.ts";

/** A plan that breaks a rule goes back to the coach this many times before it is dropped. */
const RETRIES = 2;
/**
 * Each model call gives up after this, so three calls end well inside the 10 minutes a writing
 * holds its claim (STALE_WRITING_MS in coach-plan.server.ts).
 */
const MODEL_TIMEOUT_MS = 150_000;
/** Paced like a real model, so the app's "writing" state shows in development and e2e. */
const MOCK_PAUSE_MS = 1500;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SYSTEM_PROMPT = [
  "You are the running coach writing an athlete's coach plan in VO2. VO2 sets the weekly budget and checks every plan in code; you write precise sessions inside it. Answer only with the requested JSON.",
  "Each session: date (YYYY-MM-DD), kind, key (true for the long run and quality sessions), a short title, a one-sentence why, and blocks of steps. A block runs its steps `repeat` times: 6 × (300 m R, 300 m jog) is one block with repeat 6 and two steps. Warm-up and cool-down are their own blocks with repeat 1.",
  "Each step has part (warmup, work, recovery, cooldown), exactly one of distanceM or durationS, and exactly one of pace (a training pace type) or effort; leave the other null. Never write a pace number: VO2 fills in the athlete's ranges.",
  "VO2 works out each session's distance and time from its steps, counting time steps at the middle of their pace. Those numbers are what the rules check.",
  "The coaching knowledge you write from follows.",
  principles,
  paces,
  sessions,
].join("\n\n");

export type PlanPrompt = Record<string, unknown>;

/** The rules in numbers for this athlete, so the coach can size sessions to pass them. */
export function rulesFor(ctx: RuleContext) {
  const { runsPerWeek } = ctx.availability;
  return [
    "1. Each week's total distance stays at or under its budgetKm (lighter and taper weeks have smaller budgets), and a week written in full reaches at least 90 % of it: aim for 95–100 %. Sessions already kept count toward their week; plannedBefore does not.",
    "2. No run more than 10 % longer than the longest run of the 30 days before it (recentTraining.longestRunLast30DaysKm, then plannedBefore and your own planned runs).",
    "3. Never two hard days in a row, never the long run the day after a hard day, also across plannedBefore. Races are hard days.",
    `4. At most ${maxQualitySessions(runsPerWeek)} quality session(s) a week (tempo, intervals, repetitions, hills, fartlek, marathonPace). A race counts as one.`,
    `5. One long run a week, on the long run day. The week's longest run, whatever its kind, is at most ${Math.round(maxLongShare(4) * 100)} % of the week's distance (${Math.round(maxLongShare(3) * 100)} % when only 3 of the athlete's runs fit the week, ${Math.round(maxLongShare(2) * 100)} % when 2), so write all ${runsPerWeek} runs, and at most ${MAX_LONG_MINUTES} minutes.`,
    "6. Lighter weeks and 7. taper weeks: stay inside their smaller budget.",
    "8. One run a day at most. A missed session is skipped, never made up.",
    `Availability: ${runsPerWeek} runs a week at most, only on the athlete's days, each within that day's minutes. Write sessions from ${ctx.from} on; days before are kept. Write nothing on race days.`,
  ];
}

export function paceText(ranges: Record<PaceType, PaceRange> | null) {
  if (!ranges) return "No training paces yet: write every step as an effort.";
  return Object.fromEntries(
    Object.entries(ranges).map(([type, range]) => [
      type,
      `${formatPaceClock(range.fastSecPerKm)}–${formatPaceClock(range.slowSecPerKm)} /km`,
    ]),
  );
}

export function weeksText(ctx: RuleContext) {
  return ctx.weeks.map((week) => ({
    weekStart: week.weekStart,
    phase: PHASES[week.phase].label,
    lighter: week.lighter,
    taper: week.taper,
    budgetKm: week.budgetKm,
    kept: ctx.frozen
      .filter(
        (session) => session.date >= week.weekStart && session.date < addDayKey(week.weekStart, 7),
      )
      .map((session) => `${session.date} ${session.kind} ${session.distanceKm} km`),
    races: ctx.raceDays.filter(
      (date) => date >= week.weekStart && date < addDayKey(week.weekStart, 7),
    ),
  }));
}

export function availabilityText(ctx: RuleContext) {
  const { availability } = ctx;
  return {
    runsPerWeek: availability.runsPerWeek,
    days: availability.days.map((day) => `${WEEKDAYS[day.weekday]}: ${day.minutes} min`),
    longRunDay: WEEKDAYS[availability.longRunDay],
  };
}

function breaksText(breaks: RuleBreak[]) {
  return breaks.map((item) => `- ${item.rule}: ${item.message}`).join("\n");
}

export type WriteResult = { ok: true; sessions: PlannedRun[] } | { ok: false; error: string };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the coach for the sessions, checks them, and sends a failing plan back with the rules it
 * broke, at most twice. The mock coach writes a plan that passes, without a model.
 */
export async function writeSessions(
  coach: Exclude<CoachModel, { kind: "missing" }>,
  prompt: PlanPrompt,
  ctx: RuleContext,
  ranges: Record<PaceType, PaceRange> | null,
): Promise<WriteResult> {
  const plan = (written: WrittenPlan) =>
    written.sessions.map((session) => plannedRun(session, ranges));
  if (coach.kind === "mock") {
    await pause(MOCK_PAUSE_MS);
    const sessions = plan({ sessions: mockCoachPlan(ctx, ranges) });
    const breaks = checkPlan(sessions, ctx);
    if (breaks.length) return { ok: false, error: breaksText(breaks) };
    return { ok: true, sessions };
  }
  const messages: ModelMessage[] = [{ role: "user", content: JSON.stringify(prompt) }];
  let breaks: RuleBreak[] = [];
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    let written: WrittenPlan;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
    try {
      written = (await chat({
        adapter: coach.adapter,
        threadId: crypto.randomUUID(),
        systemPrompts: [SYSTEM_PROMPT],
        messages,
        outputSchema: writtenPlanSchema,
        abortController: abort,
      })) as WrittenPlan;
    } catch (error) {
      // The athlete's key must never reach a log or the screen, even inside a provider's error.
      const message = scrubSecrets(error instanceof Error ? error.message : String(error), [
        coach.key,
      ]);
      logger.warn("coach_plan.model_failed", { model: coach.model, error: message });
      return {
        ok: false,
        error: abort.signal.aborted
          ? "The coach took too long to answer. Try again, or pick a quicker model in Settings → Coach."
          : `The coach could not write the plan: ${message}`,
      };
    } finally {
      clearTimeout(timer);
    }
    const sessions = plan(written);
    breaks = checkPlan(sessions, ctx);
    logger.info("coach_plan.checked", {
      attempt,
      sessions: sessions.length,
      broken: breaks.length,
    });
    if (!breaks.length) return { ok: true, sessions };
    messages.push(
      { role: "assistant", content: JSON.stringify(written) },
      {
        role: "user",
        content: `VO2 checked the plan and it breaks these rules:\n${breaksText(breaks)}\nWrite the whole plan again for the same days, fixing every one.`,
      },
    );
  }
  return {
    ok: false,
    error: `The coach's plan still broke VO2's rules after ${RETRIES} retries:\n${breaksText(breaks.slice(0, 4))}`,
  };
}
