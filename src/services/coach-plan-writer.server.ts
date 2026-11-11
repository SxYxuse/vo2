import { chat, type ModelMessage } from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";

// Server-only: imported from handlers alone, so the coaching knowledge stays out of the app.
import cycling from "@/coaching/cycling.md?raw";
import running from "@/coaching/running.md?raw";
import season from "@/coaching/season.md?raw";
import swimming from "@/coaching/swimming.md?raw";
import { logger } from "@/lib/logger.server.ts";
import type { CoachModel } from "./coach-model.server.ts";
import { mockCoachPlan } from "./coach-plan-mock.ts";
import {
  checkPlan,
  MAX_LONG_MINUTES,
  MAX_LONG_RIDE_MINUTES,
  MAX_LONG_SWIM_MINUTES,
  MAX_QUALITY_ACROSS_SPORTS,
  maxLongRideShare,
  maxLongShare,
  maxQualitySessions,
  leftToWrite,
  type RaceEffort,
  type RuleBreak,
  type RuleContext,
} from "./coach-plan-rules.ts";
import {
  bandText,
  DRILLS,
  plannedSession,
  plannedSports,
  RIDE_ZONES,
  sessionAmountText,
  SWIM_ZONES,
  swimPaceText,
  writtenPlanSchema,
  type PlanAnchors,
  type PlannedSession,
  type PlanSport,
  type WrittenPlan,
} from "./coach-plan.types.ts";
import type { WeekBudget } from "./coach-plan-budget.ts";
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

const FORMAT = [
  "You are the endurance coach writing an athlete's coach plan in VO2. VO2 sets each week's budgets and checks every plan in code; you write precise sessions inside them. Answer only with the requested JSON.",
  "Sessions have no day: you write each week's sessions, and the athlete picks the days. Never name a weekday or date in a title or why.",
  "Each session: weekStart (the Monday of its week, YYYY-MM-DD), sport (run, ride, or swim), kind, a short title, a one-sentence why, and blocks of steps. A block runs its steps `repeat` times: 6 × (300 m R, 300 m jog) is one block with repeat 6 and two steps. Warm-up and cool-down are their own blocks with repeat 1.",
  "A run step has part (warmup, work, recovery, cooldown), exactly one of distanceM or durationS, and exactly one of pace (a training pace type) or effort; zone is null. A step at marathon, threshold, interval, or repetition pace also has secPerKm: the one pace the athlete holds, in whole seconds per km, picked inside that pace's range in `paces`, or a goal's race pace from `racePaces`. Easy, effort, and walk steps have secPerKm null. A ride step has part, durationS only (distanceM null), and exactly one of zone or effort; pace and secPerKm are null. A swim step has part, distanceM in metres (durationS null), and exactly one of zone (a swim zone: recovery, endurance, tempo, threshold, vo2max, sprint) or effort (not walk); pace and secPerKm are null. Rest at the wall between repeats is a recovery step with durationS in seconds, distanceM null, and effort easy. Never write watts, heart rate, or a swim pace: VO2 fills in the athlete's own.",
  `Every step has drill null, except a swim drill: a swim step with distanceM that names its drill (${DRILLS.filter(
    (drill) => drill.sport === "swim",
  )
    .map((drill) => `${drill.id}, ${drill.label}`)
    .join(
      "; ",
    )}) and swims it at effort easy or zone recovery. Write drills as steps, not only in the title or why: 8 × (50 m drill catchUp, 15 s rest) is one block with repeat 8. The title may still name the session's focus.`,
  "Kinds for runs: easy, recovery, long, tempo, intervals, repetitions, hills, fartlek, marathonPace. Kinds for rides: easy (endurance), recovery, long, tempo (threshold), intervals (VO2 max), hills (climbing), sweetSpot, sprints. Kinds for swims: easy (endurance), recovery, long, technique, tempo (threshold, CSS), intervals (VO2 max), sprints, openWater.",
  "VO2 works out each run's distance and time from its steps, counting time steps at their secPerKm, or the middle of their pace range, each ride's time, and each swim's metres and time, counting its steps at the middle of their swim zone and its rests. Those numbers are what the rules check.",
].join("\n\n");

/** The knowledge the coach writes from: each planned sport's file, and the season's when both. */
function systemPrompt(ctx: RuleContext) {
  const sports = plannedSports(ctx.availability);
  return [
    FORMAT,
    "The coaching knowledge you write from follows.",
    ...(sports.length > 1 ? [season] : []),
    ...(sports.includes("run") ? [running] : []),
    ...(sports.includes("ride") ? [cycling] : []),
    ...(sports.includes("swim") ? [swimming] : []),
  ].join("\n\n");
}

export type PlanPrompt = Record<string, unknown>;

/** The rules in numbers for this athlete, so the coach can size sessions to pass them. */
export function rulesFor(ctx: RuleContext) {
  const { runsPerWeek, ridesPerWeek, swimsPerWeek } = ctx.availability;
  const sports = plannedSports(ctx.availability);
  const rules = [
    "1. The sessions you write in a week add up to at most its budgetKmLeft of running, budgetMinutesLeft of riding, and budgetSwimMLeft of swimming: what is left of the week's budget once the sessions kept are taken off (lighter and taper weeks have smaller budgets). A week written in full reaches at least 90 % of each: aim for 95–100 %. plannedBefore does not count.",
  ];
  if (sports.includes("run")) {
    rules.push(
      "2. No run more than 10 % longer than the longest run of the 30 days before its week (recentTraining.longestRunLast30DaysKm, then plannedBefore and your runs in earlier weeks). Runs in the same week don't raise each other's limit.",
      `4. At most ${maxQualitySessions(runsPerWeek)} quality run(s) a week (tempo, intervals, repetitions, hills, fartlek, marathonPace). A running race counts as one, unless it is run for fun: then it is one of the week's runs, an easy one. In the week of a steady running race, every other run is easy.`,
      `5. One long run a week. The week's longest run, whatever its kind, is at most twice the average of the week's other runs, and never held under 30 % of the week's running: ${[2, 3, 4, 5].map((runs) => `${Math.round(maxLongShare(runs) * 100)} % with ${runs} runs`).join(", ")}, ${Math.round(maxLongShare(6) * 100)} % from 6, counted by the runs that fit the week (the runs kept plus runsToWrite) and measured against the week's running with the runs kept. Write all the week's runs, and the long run at most ${MAX_LONG_MINUTES} minutes.`,
    );
  }
  if (sports.includes("ride")) {
    rules.push(
      "2. No ride more than 15 % longer than the longest ride of the 30 days before its week (recentTraining.longestRideLast30DaysMin, at least 90 minutes, then plannedBefore and your rides in earlier weeks).",
      `4. At most ${maxQualitySessions(ridesPerWeek)} quality ride(s) a week (tempo, intervals, hills, sweetSpot, sprints). A cycling race counts as one, unless it is ridden for fun: then it is one of the week's rides, an easy one. In the week of a steady cycling race, every other ride is easy.`,
      `5. One long ride a week. The week's longest ride is at most ${Math.round(maxLongRideShare(4) * 100)} % of the week's riding (${Math.round(maxLongRideShare(3) * 100)} % when only 3 rides fit, ${Math.round(maxLongRideShare(2) * 100)} % when 2), counting the rides kept in both, and at most ${MAX_LONG_RIDE_MINUTES} minutes.`,
    );
  }
  if (sports.includes("swim")) {
    rules.push(
      "2. No swim more than 15 % longer than the longest swim of the 30 days before its week (recentTraining.longestSwimLast30DaysM, at least 2000 m, then plannedBefore and your swims in earlier weeks).",
      `4. At most ${maxQualitySessions(swimsPerWeek)} quality swim(s) a week (tempo, intervals, sprints; technique and openWater are not quality). A swimming race counts as one, unless it is swum for fun: then it is one of the week's swims, an easy one. In the week of a steady swimming race, every other swim is easy.`,
      `5. One long swim a week. The week's longest swim is at most ${Math.round(maxLongRideShare(4) * 100)} % of the week's swimming (${Math.round(maxLongRideShare(3) * 100)} % when only 3 swims fit, ${Math.round(maxLongRideShare(2) * 100)} % when 2), counting the swims kept in both, and at most ${MAX_LONG_SWIM_MINUTES} minutes.`,
    );
  }
  if (sports.length > 1) {
    rules.push(
      `4. At most ${MAX_QUALITY_ACROSS_SPORTS} quality sessions a week across all sports, races included (but not races for fun); a multisport event's legs count as one race.`,
    );
  }
  rules.push(
    "6. Lighter weeks and 7. taper weeks: stay inside their smaller budgets.",
    "8. A missed session is skipped, never made up.",
    `Availability: ${runsPerWeek} runs, ${ridesPerWeek} rides, and ${swimsPerWeek} swims a week at most. Write no more than each week's runsToWrite, ridesToWrite, and swimsToWrite: the sessions kept are done and already taken off, and a week under way has fewer days left. Write sessions for the weeks from ${ctx.fromWeek} on. VO2 adds races itself: write none.`,
  );
  return rules;
}

/** The zones in the athlete's numbers: watts from FTP, else heart rate from cycling LTHR. */
export function zoneText(anchors: PlanAnchors) {
  const { ftp, rideLthr } = anchors;
  if (!ftp && !rideLthr) return "No FTP or cycling LTHR yet: target zones by feel.";
  return Object.fromEntries(
    RIDE_ZONES.map((zone) => {
      const watts =
        zone.ftp && ftp
          ? bandText([Math.round(ftp * zone.ftp[0]), Math.round(ftp * zone.ftp[1])], "W")
          : null;
      const bpm =
        zone.lthr && rideLthr
          ? bandText(
              [Math.round(rideLthr * zone.lthr[0]), Math.round(rideLthr * zone.lthr[1])],
              "bpm",
            )
          : null;
      return [zone.id, [watts, bpm].filter(Boolean).join(", ") || "by feel"];
    }),
  );
}

/** The swim zones in the athlete's pace per 100 m, from CSS. */
export function swimZoneText(anchors: PlanAnchors) {
  const { css } = anchors;
  if (!css) return "No CSS yet: target swim zones by feel.";
  return Object.fromEntries(
    SWIM_ZONES.map((zone) => [
      zone.id,
      zone.css
        ? swimPaceText([Math.round(css + zone.css[0]), Math.round(css + zone.css[1])])
        : "all out",
    ]),
  );
}

export function paceText(ranges: Record<PaceType, PaceRange> | null) {
  if (!ranges) return "No training paces yet: write every step as an effort.";
  return Object.fromEntries(
    Object.entries(ranges).map(([type, range]) => [
      type,
      `${formatPaceClock(range.fastSecPerKm)}–${formatPaceClock(range.slowSecPerKm)} /km (secPerKm ${range.fastSecPerKm}–${range.slowSecPerKm})`,
    ]),
  );
}

/** Each upcoming run goal's predicted race pace, which a race-pace step may target exactly. */
export function racePaceText(races: { name: string; distanceKm: number; secPerKm: number }[]) {
  return races.map(
    (race) =>
      `${race.name} (${race.distanceKm} km): ${formatPaceClock(race.secPerKm)} /km (secPerKm ${race.secPerKm})`,
  );
}

/** A kept or planned session in a line: "ride long 180 min", "run easy 8 km", "swim easy 2,400 m". */
export const sessionLine = (session: PlannedSession) =>
  `${session.sport} ${session.kind} ${session.sport === "ride" ? `${session.minutes} min` : sessionAmountText(session)}`;

/** A race as the coach reads it in its week (ADR 0052). */
const RACE_EFFORT_TEXT: Record<RaceEffort, string> = {
  perform: "main goal, raced to perform",
  fun: "supporting race for fun: it is one of the week's easy sessions, not a quality one",
  steady: "supporting race, strong and steady: the sport's other sessions this week are easy",
  allOut: "supporting race, all out",
};

const LEFT_FIELDS = {
  run: ["runsToWrite", "budgetKmLeft"],
  ride: ["ridesToWrite", "budgetMinutesLeft"],
  swim: ["swimsToWrite", "budgetSwimMLeft"],
} as const;

/** What is left to write of each sport in a week, the sessions kept taken off (rules 1 and Availability). */
export const leftText = (week: WeekBudget, ctx: RuleContext, sports: readonly PlanSport[]) =>
  Object.fromEntries(
    sports.flatMap((sport) => {
      const { sessions, budget } = leftToWrite(week, ctx, sport);
      const [count, amount] = LEFT_FIELDS[sport];
      return [
        [count, sessions],
        [amount, budget],
      ];
    }),
  );

export function weeksText(ctx: RuleContext) {
  const sports = plannedSports(ctx.availability);
  return ctx.weeks.map((week) => ({
    weekStart: week.weekStart,
    phase: PHASES[week.phase].label,
    lighter: week.lighter,
    taper: week.taper,
    ...leftText(week, ctx, sports),
    kept: ctx.frozen
      .filter((session) => session.weekStart === week.weekStart)
      .map((session) => `${sessionLine(session)}, done`),
    races: ctx.races
      .filter((race) => race.weekStart === week.weekStart)
      .map((race) => `${race.sport}, ${RACE_EFFORT_TEXT[race.effort]}`),
  }));
}

export const availabilityText = (ctx: RuleContext) => ({
  runsPerWeek: ctx.availability.runsPerWeek,
  ridesPerWeek: ctx.availability.ridesPerWeek,
  swimsPerWeek: ctx.availability.swimsPerWeek,
});

function breaksText(breaks: RuleBreak[]) {
  return breaks.map((item) => `- ${item.rule}: ${item.message}`).join("\n");
}

export type WriteResult = { ok: true; sessions: PlannedSession[] } | { ok: false; error: string };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the coach is first sent: the coaching knowledge, then the prompt as JSON. */
export function planRequest(prompt: PlanPrompt, ctx: RuleContext) {
  return {
    systemPrompts: [systemPrompt(ctx)],
    messages: [{ role: "user", content: JSON.stringify(prompt) }] as ModelMessage[],
  };
}

/** Where the dev server keeps the last request the mock coach answered, for `vp run coach:replay`. */
const RECORDED_REQUEST = ".dev-seed/plan-writer-request.json";

/**
 * Development only: the mock coach skips the prompt, so the request is kept for
 * scripts/coach-replay.ts to send to a real model. Mock Strava's athlete only, and gitignored.
 */
async function recordRequest(prompt: PlanPrompt, ctx: RuleContext, anchors: PlanAnchors) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(".dev-seed", { recursive: true });
  await writeFile(RECORDED_REQUEST, JSON.stringify({ prompt, ctx, anchors }, null, 2));
}

/**
 * Asks the coach for the sessions, checks them, and sends a failing plan back with the rules it
 * broke, at most twice. The mock coach writes a plan that passes, without a model.
 */
export async function writeSessions(
  coach: Exclude<CoachModel, { kind: "missing" }>,
  prompt: PlanPrompt,
  ctx: RuleContext,
  anchors: PlanAnchors,
): Promise<WriteResult> {
  const plan = (written: WrittenPlan) =>
    written.sessions.map((session) => plannedSession(session, anchors));
  if (coach.kind === "mock") {
    if (import.meta.env.DEV) await recordRequest(prompt, ctx, anchors);
    await pause(MOCK_PAUSE_MS);
    const sessions = plan({ sessions: mockCoachPlan(ctx, anchors.paces) });
    const breaks = checkPlan(sessions, ctx);
    if (breaks.length) return { ok: false, error: breaksText(breaks) };
    return { ok: true, sessions };
  }
  const { systemPrompts, messages } = planRequest(prompt, ctx);
  let breaks: RuleBreak[] = [];
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    let written: WrittenPlan;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
    try {
      written = (await chat({
        adapter: coach.adapter,
        reasoning: coach.reasoning,
        threadId: crypto.randomUUID(),
        systemPrompts,
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
        content: `VO2 checked the plan and it breaks these rules:\n${breaksText(breaks)}\nWrite the whole plan again for the same weeks, fixing every one.`,
      },
    );
  }
  return {
    ok: false,
    error: `The coach's plan still broke VO2's rules after ${RETRIES} retries:\n${breaksText(breaks.slice(0, 4))}`,
  };
}
