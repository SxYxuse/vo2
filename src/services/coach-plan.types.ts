import { z } from "zod";

import { formatPaceClock } from "./locomotion.ts";
import type { PhaseKind } from "./season-phase.ts";
import { sportGroupFor } from "./sport-groups.ts";
import type { Goal } from "./season.types.ts";
import {
  PACE_TYPES,
  type EasyFrom,
  type PaceRange,
  type PaceType,
} from "./training-paces.types.ts";

/*
 * The coach plan (ADR 0037): the athlete's availability, the structured session format the coach
 * writes in, and the written plan as stored. Shared by the server and the app.
 */

export const MIN_RUNS_PER_WEEK = 2;
export const MAX_RUNS_PER_WEEK = 6;

const weekdaySchema = z.number().int().min(0).max(6);

/**
 * A running day: its weekday. Availability saved before ADR 0041 stored each day as
 * `{ weekday, minutes }`; those still parse, and the minutes are dropped.
 */
const daySchema = z.preprocess(
  (day) => (typeof day === "object" && day != null && "weekday" in day ? day.weekday : day),
  weekdaySchema,
);

/** How much the athlete can run: runs a week, the days they can run, and the long run day. */
export const availabilitySchema = z
  .object({
    runsPerWeek: z.number().int().min(MIN_RUNS_PER_WEEK).max(MAX_RUNS_PER_WEEK),
    days: z.array(daySchema).max(7),
    longRunDay: weekdaySchema,
  })
  .superRefine((value, ctx) => {
    const weekdays = value.days;
    if (new Set(weekdays).size !== weekdays.length) {
      ctx.addIssue({ code: "custom", path: ["days"], message: "A day is listed twice." });
    }
    if (weekdays.length < value.runsPerWeek) {
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message: `Pick at least ${value.runsPerWeek} days for ${value.runsPerWeek} runs a week.`,
      });
    }
    if (!weekdays.includes(value.longRunDay)) {
      ctx.addIssue({
        code: "custom",
        path: ["longRunDay"],
        message: "Pick one of your running days for the long run.",
      });
    }
  });

export type Availability = z.infer<typeof availabilitySchema>;

/** A starting point: three runs on Tuesday, Thursday, and Sunday. */
export const DEFAULT_AVAILABILITY: Availability = {
  runsPerWeek: 3,
  days: [2, 4, 0],
  longRunDay: 0,
};

export function parseAvailability(value: unknown): Availability | null {
  const parsed = availabilitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** An availability as plan bases compare it, so one saved with minutes reads as without. */
export function availabilityKey(value: unknown) {
  return JSON.stringify(parseAvailability(value));
}

// ----- The session format the coach writes in -----

export const SESSION_KINDS = [
  { id: "easy", label: "Easy run" },
  { id: "recovery", label: "Recovery run" },
  { id: "long", label: "Long run" },
  { id: "tempo", label: "Threshold" },
  { id: "intervals", label: "Intervals" },
  { id: "repetitions", label: "Repetitions" },
  { id: "hills", label: "Hills" },
  { id: "fartlek", label: "Fartlek" },
  { id: "marathonPace", label: "Marathon-pace long run" },
  { id: "race", label: "Race" },
] as const;

export type SessionKind = (typeof SESSION_KINDS)[number]["id"];
const SESSION_KIND_IDS = SESSION_KINDS.map((kind) => kind.id) as [SessionKind, ...SessionKind[]];

/** Sessions with threshold, interval, repetition, or race-pace work: hard days for rule 3. */
const QUALITY_KINDS = new Set<SessionKind>([
  "tempo",
  "intervals",
  "repetitions",
  "hills",
  "fartlek",
  "marathonPace",
  "race",
]);
const LONG_KINDS = new Set<SessionKind>(["long", "marathonPace"]);

export const isQualityKind = (kind: SessionKind) => QUALITY_KINDS.has(kind);
export const isLongKind = (kind: SessionKind) => LONG_KINDS.has(kind);

/** The five efforts of `paces.md`, plus walking for recoveries. */
export const EFFORTS = [
  { id: "easy", label: "easy", pace: "easy" },
  { id: "steady", label: "steady", pace: "marathon" },
  { id: "comfortablyHard", label: "comfortably hard", pace: "threshold" },
  { id: "hard", label: "hard", pace: "interval" },
  { id: "fastRelaxed", label: "fast and relaxed", pace: "repetition" },
  { id: "walk", label: "walk", pace: null },
] as const;

export type Effort = (typeof EFFORTS)[number]["id"];
const EFFORT_IDS = EFFORTS.map((effort) => effort.id) as [Effort, ...Effort[]];
const PACE_IDS = PACE_TYPES.map((pace) => pace.id) as [PaceType, ...PaceType[]];

export const STEP_PARTS = ["warmup", "work", "recovery", "cooldown"] as const;
export type StepPart = (typeof STEP_PARTS)[number];

/**
 * One step: a distance or a time, and a pace type or an effort. Kept flat, without refinements,
 * so every structured-output model reads it the same way; the rule checker reports a step with
 * both or neither (coach-plan-rules.ts).
 */
const stepSchema = z.object({
  part: z.enum(STEP_PARTS),
  distanceM: z.number().min(0).max(50_000).nullable(),
  durationS: z
    .number()
    .min(0)
    .max(5 * 3600)
    .nullable(),
  pace: z.enum(PACE_IDS).nullable(),
  effort: z.enum(EFFORT_IDS).nullable(),
});

/** Steps run `repeat` times in a row: 6 × (300 m R, 300 m jog) is one block repeated 6 times. */
const blockSchema = z.object({
  repeat: z.number().int().min(1).max(40),
  steps: z.array(stepSchema).min(1).max(6),
});

export const writtenSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(SESSION_KIND_IDS),
  title: z.string().min(1).max(80),
  why: z.string().min(1).max(300),
  blocks: z.array(blockSchema).min(1).max(10),
});

/** What the coach answers with. */
export const writtenPlanSchema = z.object({
  sessions: z.array(writtenSessionSchema).max(40),
});

export type Step = z.infer<typeof stepSchema>;
export type WrittenSession = z.infer<typeof writtenSessionSchema>;
export type WrittenPlan = z.infer<typeof writtenPlanSchema>;

/** A step as stored: the pace type's range from the athlete's paces when it was written. */
export type PlannedStep = Step & { range: PaceRange | null };

/** A session as stored, with its distance and time worked out by VO2, not the model. */
export type PlannedRun = Omit<WrittenSession, "blocks"> & {
  id: string;
  blocks: { repeat: number; steps: PlannedStep[] }[];
  distanceKm: number;
  minutes: number;
};

export type PlanWeek = {
  weekStart: string;
  /** VO2's weekly running budget (rule 1). */
  budgetKm: number;
  phase: PhaseKind;
  lighter: boolean;
  /** A taper week before the A race, or the race week itself. */
  taper: boolean;
  sessions: PlannedRun[];
};

/** A goal as the plan was written around it: id, date, distance, priority, sport type. */
export type PlanGoal = [string, string, number | null, string, string];

/** What a written plan was written from; a change in any of it rewrites the weeks ahead. */
export type PlanBasis = {
  availability: string;
  goals: PlanGoal[];
  vdot: number | null;
  /**
   * The easy pace's middle and where it came from (ADR 0042). Plans written before it was kept
   * have none, and are not rewritten for it.
   */
  easy?: { from: EasyFrom; secPerKm: number } | null;
};

export type CoachPlan = {
  weeks: PlanWeek[];
  basis: PlanBasis;
  writtenAt: string;
  model: string;
};

export type CoachPlanStatus = "idle" | "writing" | "failed";

/** What the coach plan still needs before it can be written. */
export type CoachPlanMissing = "key" | "goal" | "availability";

export type GoalSummary = Pick<Goal, "id" | "name" | "date" | "distanceM" | "sportType">;

export type CoachPlanState = {
  signedIn: boolean;
  today: string;
  availability: Availability | null;
  /** The upcoming A running goal with a distance the plan builds toward. */
  aGoal: GoalSummary | null;
  missing: CoachPlanMissing[];
  plan: CoachPlan | null;
  status: CoachPlanStatus;
  /** Why the last writing failed, in words for the athlete. */
  error: string | null;
  /** The athlete's activities over the plan's weeks, each with the session it did, if any. */
  activities: PlanActivity[];
  /** The weeks from this one to the A race, with their season phase. */
  road: { weekStart: string; phase: PhaseKind }[];
  /** The VDOT of the athlete's training paces, for the predicted race time. */
  vdot: number | null;
};

// ----- Done matching -----

/** A run on the session's day covering this share of its distance counts as doing it. */
export const DONE_SHARE = 0.7;

/** Runs the athlete linked to sessions by hand, and runs they said did none (ADR 0037). */
export type SessionLinks = {
  /** Session id to the activity the athlete linked to it. */
  linked: Record<string, string>;
  /** Activities the athlete unlinked: never matched to a session automatically again. */
  unlinked: string[];
};

export function parseLinks(value: unknown): SessionLinks {
  const links = (value ?? {}) as Partial<SessionLinks>;
  return { linked: links.linked ?? {}, unlinked: links.unlinked ?? [] };
}

/** An activity on a day of the plan, with the session it did. */
export type PlanActivity = {
  id: string;
  date: string;
  name: string;
  sportType: string;
  km: number;
  seconds: number;
  /** The session it did, or null for an extra. Only runs do sessions. */
  sessionId: string | null;
  /** Linked by the athlete rather than matched. */
  manual: boolean;
};

type MatchRun = { id: string; date: string; km: number };

/**
 * Which run did each session: the athlete's link first, else the longest run on the session's day
 * covering 70 % of its distance that no other session took and the athlete didn't unlink.
 */
export function matchSessions(
  sessions: Pick<PlannedRun, "id" | "date" | "distanceKm">[],
  runs: MatchRun[],
  links: SessionLinks,
  today: string,
) {
  const matched = new Map<string, { runId: string; manual: boolean }>();
  const used = new Set<string>();
  for (const session of sessions) {
    const runId = links.linked[session.id];
    if (runId && runs.some((run) => run.id === runId) && !used.has(runId)) {
      matched.set(session.id, { runId, manual: true });
      used.add(runId);
    }
  }
  const unlinked = new Set(links.unlinked);
  for (const session of sessions) {
    if (matched.has(session.id) || session.date > today) continue;
    const run = runs
      .filter(
        (item) =>
          item.date === session.date &&
          !used.has(item.id) &&
          !unlinked.has(item.id) &&
          item.km >= session.distanceKm * DONE_SHARE,
      )
      .sort((a, b) => b.km - a.km)[0];
    if (!run) continue;
    matched.set(session.id, { runId: run.id, manual: false });
    used.add(run.id);
  }
  return matched;
}

export type SessionStatus = "done" | "missed" | "planned";

export function sessionStatus(
  session: Pick<PlannedRun, "id" | "date">,
  activities: PlanActivity[],
  today: string,
): SessionStatus {
  if (activities.some((item) => item.sessionId === session.id)) return "done";
  return session.date < today ? "missed" : "planned";
}

/** The A goal the coach plan builds toward: the next A run with a distance. */
export function coachPlanGoal(goals: Goal[], today: string): Goal | null {
  return (
    goals
      .filter(
        (goal) =>
          goal.priority === "A" &&
          goal.date >= today &&
          goal.distanceM != null &&
          goal.distanceM > 0 &&
          sportGroupFor(goal.sportType)?.id === "running",
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  );
}

// ----- Distance, time, and text of a session -----

/** Seconds per km used when the athlete has no training paces, by effort. */
const NO_PACE_SEC_PER_KM: Record<Effort, number> = {
  easy: 390,
  steady: 345,
  comfortablyHard: 315,
  hard: 290,
  fastRelaxed: 270,
  walk: 600,
};

const PACE_EFFORT: Record<PaceType, Effort> = {
  easy: "easy",
  marathon: "steady",
  threshold: "comfortablyHard",
  interval: "hard",
  repetition: "fastRelaxed",
};

const middle = (range: PaceRange) => (range.slowSecPerKm + range.fastSecPerKm) / 2;

/**
 * The seconds per km a step is counted at: the middle of its pace range, or of the pace an effort
 * sits at, so time steps count toward distance and distance steps toward time.
 */
export function stepSecPerKm(step: Step, paces: Record<PaceType, PaceRange> | null) {
  const effort = step.effort ?? (step.pace ? PACE_EFFORT[step.pace] : "easy");
  if (effort === "walk") return NO_PACE_SEC_PER_KM.walk;
  const pace = step.pace ?? EFFORTS.find((item) => item.id === effort)?.pace ?? "easy";
  return paces ? middle(paces[pace]) : NO_PACE_SEC_PER_KM[effort];
}

/** A session's distance (km) and time (minutes), from its steps. */
export function sessionSize(
  blocks: { repeat: number; steps: Step[] }[],
  paces: Record<PaceType, PaceRange> | null,
) {
  let metres = 0;
  let seconds = 0;
  for (const block of blocks) {
    for (const step of block.steps) {
      const secPerKm = stepSecPerKm(step, paces);
      const stepMetres = step.distanceM ?? ((step.durationS ?? 0) / secPerKm) * 1000;
      const stepSeconds = step.durationS ?? ((step.distanceM ?? 0) / 1000) * secPerKm;
      metres += stepMetres * block.repeat;
      seconds += stepSeconds * block.repeat;
    }
  }
  return { distanceKm: Math.round(metres / 100) / 10, minutes: Math.round(seconds / 60) };
}

/** A written session as stored: sized, and each pace step given its range. */
export function plannedRun(
  session: WrittenSession,
  paces: Record<PaceType, PaceRange> | null,
): PlannedRun {
  const blocks = session.blocks.map((block) => ({
    repeat: block.repeat,
    steps: block.steps.map((step) => ({
      ...step,
      range: step.pace && paces ? paces[step.pace] : null,
    })),
  }));
  return {
    ...session,
    id: `${session.date}-${session.kind}`,
    blocks,
    ...sessionSize(session.blocks, paces),
  };
}

/** "800 m", "2.5 km", "90 s", "20 min". */
export function stepAmountText(step: Step) {
  if (step.distanceM != null) {
    return step.distanceM >= 1000
      ? `${Math.round(step.distanceM / 100) / 10} km`
      : `${Math.round(step.distanceM)} m`;
  }
  const seconds = Math.round(step.durationS ?? 0);
  if (seconds < 120 && seconds % 60 !== 0) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

function targetText(step: PlannedStep) {
  if (step.pace) {
    const letter = PACE_TYPES.find((pace) => pace.id === step.pace)!.letter;
    return step.range
      ? `${letter} ${formatPaceClock(step.range.fastSecPerKm)}–${formatPaceClock(step.range.slowSecPerKm)} /km`
      : letter;
  }
  if (step.part === "recovery" && step.effort === "easy") return "jog";
  return EFFORTS.find((effort) => effort.id === step.effort)?.label ?? "easy";
}

const PART_PREFIX: Partial<Record<StepPart, string>> = {
  warmup: "Warm-up: ",
  cooldown: "Cool-down: ",
};

function stepText(step: PlannedStep) {
  return `${PART_PREFIX[step.part] ?? ""}${stepAmountText(step)} ${targetText(step)}`;
}

/** One line per block, the way `sessions.md` writes them: "6 × 300 m R …, 300 m jog". */
export function sessionLines(run: Pick<PlannedRun, "blocks">) {
  return run.blocks.map((block) => {
    const steps = block.steps.map(stepText).join(", ");
    return block.repeat === 1 ? steps : `${block.repeat} × ${steps}`;
  });
}

export function sessionKindLabel(kind: SessionKind) {
  return SESSION_KINDS.find((item) => item.id === kind)?.label ?? kind;
}
