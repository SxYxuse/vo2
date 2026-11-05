import { z } from "zod";

import { formatPaceClock } from "./locomotion.ts";
import type { SportSeed, WeekShape } from "./coach-plan-budget.ts";
import type { PhaseKind, SeasonWeek } from "./season-phase.ts";
import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import type { Goal } from "./season.types.ts";
import {
  PACE_TYPES,
  type EasyFrom,
  type PaceRange,
  type PaceType,
} from "./training-paces.types.ts";

/*
 * The coach plan (ADR 0037, ADR 0050): the athlete's availability, the structured session format
 * the coach writes in, and the written plan as stored. Shared by the server and the app. Sessions
 * belong to a week and have no day or order (ADR 0048): the athlete picks when to do them. The
 * plan holds runs and rides; swims, walks, and other sports count toward load but aren't planned.
 */

export const PLAN_SPORTS = [
  { id: "run", group: "running", label: "Run", plural: "runs" },
  { id: "ride", group: "cycling", label: "Ride", plural: "rides" },
] as const;

export type PlanSport = (typeof PLAN_SPORTS)[number]["id"];
const PLAN_SPORT_IDS = PLAN_SPORTS.map((sport) => sport.id) as [PlanSport, ...PlanSport[]];

/** The plan sport of a Strava sport type, or null when the coach plan doesn't plan it. */
export function planSportOf(sportType: string): PlanSport | null {
  const group: SportGroupId | undefined = sportGroupFor(sportType)?.id;
  return PLAN_SPORTS.find((sport) => sport.group === group)?.id ?? null;
}

export const MAX_SESSIONS_PER_SPORT = 6;

/**
 * How much the athlete can train: runs and rides a week (ADR 0048, ADR 0050). Availability saved
 * before rides had only runs, so rides default to none; older keys such as days are dropped.
 */
export const availabilitySchema = z
  .object({
    runsPerWeek: z.number().int().min(0).max(MAX_SESSIONS_PER_SPORT),
    ridesPerWeek: z.number().int().min(0).max(MAX_SESSIONS_PER_SPORT).default(0),
  })
  .refine((value) => value.runsPerWeek + value.ridesPerWeek >= 2, {
    error: "Plan at least two sessions a week.",
  });

export type Availability = z.output<typeof availabilitySchema>;

export const DEFAULT_AVAILABILITY: Availability = { runsPerWeek: 3, ridesPerWeek: 0 };

export function parseAvailability(value: unknown): Availability | null {
  const parsed = availabilitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** An availability as plan bases compare it, so one saved with days reads as without. */
export function availabilityKey(value: unknown) {
  return JSON.stringify(parseAvailability(value));
}

export function sessionsPerWeek(availability: Availability, sport: PlanSport) {
  return sport === "run" ? availability.runsPerWeek : availability.ridesPerWeek;
}

/**
 * How fast each sport's weekly budget grows, and the athlete's own peak, when they set one (ADR
 * 0058). Growth is the base phase's weekly %, from Hold (0) to Steep (10); a sport left unset
 * grows at Standard when the A goal is in it and holds otherwise. Peak is in the sport's unit (km
 * of running, minutes of riding); null is the peak VO2 recommends.
 */
const sportProgressionSchema = (peakLimit: number) =>
  z.object({
    growth: z.number().min(0).max(10).multipleOf(0.5),
    peak: z.number().int().positive().max(peakLimit).nullable(),
  });

/** Peaks up to 200 km of running and 25 h of riding (PEAK_LIMIT in coach-plan-budget.ts). */
export const progressionSchema = z.object({
  run: sportProgressionSchema(200).optional(),
  ride: sportProgressionSchema(25 * 60).optional(),
});

export type Progression = z.output<typeof progressionSchema>;

export function parseProgression(value: unknown): Progression {
  const parsed = progressionSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** The named marks on the progression slider, in % a week. */
export const PROGRESSION_MARKS = [
  { growth: 0, label: "Hold" },
  { growth: 3, label: "Gentle" },
  { growth: 5, label: "Standard" },
  { growth: 7, label: "Bold" },
  { growth: 10, label: "Steep" },
] as const;

/** "42 km" of running, "4.5 h" of riding (riding budgets are in minutes). */
export function amountText(sport: PlanSport, amount: number) {
  if (sport === "run") return `${Math.round(amount)} km`;
  return `${Math.round((amount / 60) * 10) / 10} h`;
}

/** "Standard", or "+6 %" between the marks. */
export function progressionLabel(growth: number) {
  return PROGRESSION_MARKS.find((mark) => mark.growth === growth)?.label ?? `+${growth} %`;
}

/** The sports the athlete's availability plans. */
export const plannedSports = (availability: Availability) =>
  PLAN_SPORT_IDS.filter((sport) => sessionsPerWeek(availability, sport) > 0);

// ----- The session format the coach writes in -----

/** Each kind with its name per sport; null where the kind isn't written for that sport. */
export const SESSION_KINDS = [
  { id: "easy", run: "Easy run", ride: "Endurance ride" },
  { id: "recovery", run: "Recovery run", ride: "Recovery ride" },
  { id: "long", run: "Long run", ride: "Long ride" },
  { id: "tempo", run: "Threshold", ride: "Threshold" },
  { id: "intervals", run: "Intervals", ride: "VO2 max intervals" },
  { id: "repetitions", run: "Repetitions", ride: null },
  { id: "hills", run: "Hills", ride: "Climbing" },
  { id: "fartlek", run: "Fartlek", ride: null },
  { id: "marathonPace", run: "Marathon-pace long run", ride: null },
  { id: "sweetSpot", run: null, ride: "Sweet spot" },
  { id: "sprints", run: null, ride: "Sprints" },
  { id: "race", run: "Race", ride: "Race" },
] as const;

export type SessionKind = (typeof SESSION_KINDS)[number]["id"];
const SESSION_KIND_IDS = SESSION_KINDS.map((kind) => kind.id) as [SessionKind, ...SessionKind[]];

/** Sessions with threshold, interval, sprint, or race-pace work: quality sessions (rule 4). */
const QUALITY_KINDS = new Set<SessionKind>([
  "tempo",
  "intervals",
  "repetitions",
  "hills",
  "fartlek",
  "marathonPace",
  "sweetSpot",
  "sprints",
  "race",
]);
const LONG_KINDS = new Set<SessionKind>(["long", "marathonPace"]);

export const isQualityKind = (kind: SessionKind) => QUALITY_KINDS.has(kind);
export const isLongKind = (kind: SessionKind) => LONG_KINDS.has(kind);
export const kindFitsSport = (kind: SessionKind, sport: PlanSport) =>
  SESSION_KINDS.find((item) => item.id === kind)?.[sport] != null;

/** The five efforts of `coaching/running.md`, plus walking for recoveries. */
export const EFFORTS = [
  { id: "easy", label: "easy", pace: "easy", zone: "endurance" },
  { id: "steady", label: "steady", pace: "marathon", zone: "tempo" },
  { id: "comfortablyHard", label: "comfortably hard", pace: "threshold", zone: "threshold" },
  { id: "hard", label: "hard", pace: "interval", zone: "vo2max" },
  { id: "fastRelaxed", label: "fast and relaxed", pace: "repetition", zone: "anaerobic" },
  { id: "walk", label: "walk", pace: null, zone: null },
] as const;

export type Effort = (typeof EFFORTS)[number]["id"];
const EFFORT_IDS = EFFORTS.map((effort) => effort.id) as [Effort, ...Effort[]];
const PACE_IDS = PACE_TYPES.map((pace) => pace.id) as [PaceType, ...PaceType[]];

/**
 * Cycling zones a ride step targets (`coaching/cycling.md`): Coggan's levels as a share of FTP, with
 * sweet spot between tempo and threshold, and as a share of cycling LTHR where heart rate still
 * reads the effort. Above threshold heart rate lags too much to steer by.
 */
export const RIDE_ZONES = [
  { id: "recovery", label: "recovery", level: 1, ftp: [0.4, 0.55], lthr: [0.6, 0.68] },
  { id: "endurance", label: "endurance", level: 2, ftp: [0.56, 0.75], lthr: [0.69, 0.83] },
  { id: "tempo", label: "tempo", level: 3, ftp: [0.76, 0.87], lthr: [0.84, 0.9] },
  { id: "sweetSpot", label: "sweet spot", level: 3, ftp: [0.88, 0.94], lthr: [0.91, 0.95] },
  { id: "threshold", label: "threshold", level: 4, ftp: [0.95, 1.05], lthr: [0.95, 1.02] },
  { id: "vo2max", label: "VO2 max", level: 5, ftp: [1.06, 1.2], lthr: null },
  { id: "anaerobic", label: "anaerobic", level: 5, ftp: [1.21, 1.5], lthr: null },
  { id: "sprint", label: "all-out sprint", level: 5, ftp: null, lthr: null },
] as const;

export type RideZone = (typeof RIDE_ZONES)[number]["id"];
const RIDE_ZONE_IDS = RIDE_ZONES.map((zone) => zone.id) as [RideZone, ...RideZone[]];
export const rideZone = (id: RideZone) => RIDE_ZONES.find((zone) => zone.id === id)!;

export const STEP_PARTS = ["warmup", "work", "recovery", "cooldown"] as const;
export type StepPart = (typeof STEP_PARTS)[number];

/**
 * One step: a distance or a time, and a target. A run targets a pace type or an effort; a ride
 * targets a zone or an effort, by time only. A run step at a pace harder than easy also names one
 * pace in seconds per km, inside its pace type's range or at a goal's race pace (ADR 0055). Kept flat, without refinements, so every
 * structured-output model reads it the same way; the rule checker reports a step that mixes them
 * (coach-plan-rules.ts).
 */
const stepSchema = z.object({
  part: z.enum(STEP_PARTS),
  distanceM: z.number().min(0).max(50_000).nullable(),
  durationS: z
    .number()
    .min(0)
    .max(7 * 3600)
    .nullable(),
  pace: z.enum(PACE_IDS).nullable(),
  secPerKm: z.number().min(120).max(900).nullable(),
  zone: z.enum(RIDE_ZONE_IDS).nullable(),
  effort: z.enum(EFFORT_IDS).nullable(),
});

/** Steps run `repeat` times in a row: 6 × (300 m R, 300 m jog) is one block repeated 6 times. */
const blockSchema = z.object({
  repeat: z.number().int().min(1).max(40),
  steps: z.array(stepSchema).min(1).max(6),
});

export const writtenSessionSchema = z.object({
  /** The Monday of the session's week: a session has no day (ADR 0048). */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sport: z.enum(PLAN_SPORT_IDS),
  kind: z.enum(SESSION_KIND_IDS),
  title: z.string().min(1).max(80),
  why: z.string().min(1).max(300),
  blocks: z.array(blockSchema).min(1).max(10),
});

/** What the coach answers with. */
export const writtenPlanSchema = z.object({
  sessions: z.array(writtenSessionSchema).max(60),
});

export type Step = z.infer<typeof stepSchema>;
export type WrittenSession = z.infer<typeof writtenSessionSchema>;
export type WrittenPlan = z.infer<typeof writtenPlanSchema>;

/** Watts or bpm, low to high. */
export type Band = [number, number];

/**
 * A step as stored, with what it targets in the athlete's numbers when it was written: a run's
 * pace range, or a ride zone's watts from FTP and, below VO2 max, its heart rate from LTHR.
 */
export type PlannedStep = Step & {
  range: PaceRange | null;
  watts?: Band | null;
  bpm?: Band | null;
};

/**
 * A session as stored, with its size worked out by VO2, not the model: a run's distance and
 * time, a ride's time (its distance is 0: rides are planned by time).
 */
export type PlannedSession = Omit<WrittenSession, "blocks"> & {
  id: string;
  blocks: { repeat: number; steps: PlannedStep[] }[];
  distanceKm: number;
  minutes: number;
  /** Marked done by the athlete (ADR 0048). Plans stored before it have none: open. */
  done?: boolean;
};

export type PlanWeek = {
  weekStart: string;
  /** VO2's weekly running budget (rule 1). */
  budgetKm: number;
  /** VO2's weekly riding budget, in minutes (rule 1). Plans written before rides have none. */
  budgetMinutes?: number;
  phase: PhaseKind;
  lighter: boolean;
  /** A taper week before a main goal or an all-out race, or the race week itself. */
  taper: boolean;
  sessions: PlannedSession[];
};

/**
 * A goal as the plan was written around it: id, date, distance, priority, sport type, and a
 * supporting race's effort. A main goal has no sixth item, so plans written before efforts are
 * not rewritten for one.
 */
export type PlanGoal = [string, string, number | null, string, string, string?];

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
  /** FTP in watts (ADR 0050). Plans written before rides have none, and aren't rewritten for it. */
  ftp?: number | null;
};

export type CoachPlan = {
  weeks: PlanWeek[];
  basis: PlanBasis;
  writtenAt: string;
  model: string;
};

/** A stored plan with every session's sport: sessions written before rides are runs. */
export function readCoachPlan(value: unknown): CoachPlan | null {
  if (!value) return null;
  const plan = value as CoachPlan;
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({ ...session, sport: session.sport ?? "run" })),
    })),
  };
}

export type CoachPlanStatus = "idle" | "writing" | "failed";

/** What the coach plan still needs before it can be written. */
export type CoachPlanMissing = "key" | "goal" | "availability" | "goalSport";

export type GoalSummary = Pick<Goal, "id" | "name" | "date" | "distanceM" | "sportType">;

export type CoachPlanState = {
  signedIn: boolean;
  today: string;
  availability: Availability | null;
  /** The upcoming A run or ride with a distance the plan builds toward. */
  aGoal: GoalSummary | null;
  missing: CoachPlanMissing[];
  plan: CoachPlan | null;
  status: CoachPlanStatus;
  /** Why the last writing failed, in words for the athlete. */
  error: string | null;
  /** The season week by week, from this one through the last goal ahead. */
  road: SeasonWeek[];
  /** The goals ahead, every sport, in date order. */
  goals: Goal[];
  /** The VDOT of the athlete's training paces, for the predicted race time. */
  vdot: number | null;
  /** The season's volume, for Plan's charts and the progression setting; null without an A goal. */
  volume: SeasonVolume | null;
};

/**
 * What the app needs to draw each planned sport's season and recompute it live as the athlete
 * moves the progression (ADR 0058): the season's weeks and each sport's starting point.
 */
export type SeasonVolume = {
  shape: WeekShape[];
  sports: SportVolume[];
};

export type SportVolume = {
  sport: PlanSport;
  seed: SportSeed;
  /** What the athlete set; null growth is the default by week (Standard for the A goal's sport). */
  growth: number | null;
  /** The growth the slider shows when the athlete set none: the A goal's sport grows. */
  defaultGrowth: number;
  /** The athlete's own peak, or null for the recommended one. */
  peak: number | null;
  recommended: number;
  /** The goal that sets the ceiling, with what it usually asks, or null without one. */
  goal: { name: string; floor: number } | null;
  /** What's done of the sport this week, for the current week's bar. */
  doneThisWeek: number;
};

/** The A goal the coach plan builds toward: the next A run or ride with a distance. */
export function coachPlanGoal(goals: Goal[], today: string): Goal | null {
  return (
    goals
      .filter(
        (goal) =>
          goal.priority === "A" &&
          goal.date >= today &&
          goal.distanceM != null &&
          goal.distanceM > 0 &&
          planSportOf(goal.sportType) != null,
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

/** A ride step written by distance, which the rules refuse, is still sized at this speed. */
const RIDE_KMH = 25;

const middle = (range: PaceRange) => (range.slowSecPerKm + range.fastSecPerKm) / 2;

/**
 * The seconds per km a run step is counted at: its own pace, else the middle of its pace range, or
 * of the pace an effort sits at, so time steps count toward distance and distance steps toward
 * time. Steps stored before ADR 0055 have no pace of their own.
 */
export function stepSecPerKm(step: Step, paces: Record<PaceType, PaceRange> | null) {
  if (step.secPerKm != null) return step.secPerKm;
  const effort = step.effort ?? (step.pace ? PACE_EFFORT[step.pace] : "easy");
  if (effort === "walk") return NO_PACE_SEC_PER_KM.walk;
  const pace = step.pace ?? EFFORTS.find((item) => item.id === effort)?.pace ?? "easy";
  return paces ? middle(paces[pace]) : NO_PACE_SEC_PER_KM[effort];
}

/** A session's distance (km) and time (minutes), from its steps; a ride's distance is 0. */
export function sessionSize(
  sport: PlanSport,
  blocks: { repeat: number; steps: Step[] }[],
  paces: Record<PaceType, PaceRange> | null,
) {
  let metres = 0;
  let seconds = 0;
  for (const block of blocks) {
    for (const step of block.steps) {
      const secPerKm = sport === "ride" ? 3600 / RIDE_KMH : stepSecPerKm(step, paces);
      const stepMetres = step.distanceM ?? ((step.durationS ?? 0) / secPerKm) * 1000;
      const stepSeconds = step.durationS ?? ((step.distanceM ?? 0) / 1000) * secPerKm;
      metres += stepMetres * block.repeat;
      seconds += stepSeconds * block.repeat;
    }
  }
  const distanceKm = sport === "ride" ? 0 : Math.round(metres / 100) / 10;
  return { distanceKm, minutes: Math.round(seconds / 60) };
}

/** What a planned step is aimed at, in the athlete's own numbers. */
export type PlanAnchors = {
  paces: Record<PaceType, PaceRange> | null;
  /** FTP in watts, for ride zones. */
  ftp: number | null;
  /** Cycling LTHR, for ride zones without power. */
  rideLthr: number | null;
};

/** The zone a ride step targets: its own, or the one its effort sits at. */
export function stepZone(step: Pick<Step, "zone" | "effort">): RideZone {
  return step.zone ?? EFFORTS.find((item) => item.id === step.effort)?.zone ?? "endurance";
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

function rideTargets(step: Step, anchors: PlanAnchors) {
  if (step.effort === "walk") return { watts: null, bpm: null };
  const zone = rideZone(stepZone(step));
  const { ftp, rideLthr } = anchors;
  return {
    watts:
      zone.ftp && ftp
        ? ([roundTo(ftp * zone.ftp[0], 5), roundTo(ftp * zone.ftp[1], 5)] as Band)
        : null,
    bpm:
      zone.lthr && rideLthr
        ? ([Math.round(rideLthr * zone.lthr[0]), Math.round(rideLthr * zone.lthr[1])] as Band)
        : null,
  };
}

/**
 * A written session as stored: sized, each step given its targets, and open. Its id is new unless
 * it replaces a session, which keeps that one's id so a link to it still opens it.
 */
export function plannedSession(
  session: WrittenSession,
  anchors: PlanAnchors,
  id: string = crypto.randomUUID(),
): PlannedSession {
  const { paces } = anchors;
  const blocks = session.blocks.map((block) => ({
    repeat: block.repeat,
    steps: block.steps.map((step): PlannedStep => {
      if (session.sport === "ride") return { ...step, range: null, ...rideTargets(step, anchors) };
      return { ...step, range: step.pace && paces ? paces[step.pace] : null };
    }),
  }));
  return {
    ...session,
    id,
    blocks,
    ...sessionSize(session.sport, session.blocks, paces),
    done: false,
  };
}

/** "800 m", "2.5 km", "90 s", "20 min", "1 h 30". */
export function stepAmountText(step: Step) {
  if (step.distanceM != null) {
    return step.distanceM >= 1000
      ? `${Math.round(step.distanceM / 100) / 10} km`
      : `${Math.round(step.distanceM)} m`;
  }
  const seconds = Math.round(step.durationS ?? 0);
  if (seconds < 120 && seconds % 60 !== 0) return `${seconds} s`;
  return minutesText(Math.round(seconds / 60));
}

/** "45 min", "1 h", "2 h 15". */
export function minutesText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

/** A session's headline size: a run's distance, a ride's time. */
export function sessionAmountText(
  session: Pick<PlannedSession, "sport" | "distanceKm" | "minutes">,
) {
  return session.sport === "ride" ? minutesText(session.minutes) : `${session.distanceKm} km`;
}

export const bandText = (band: Band, unit: string) => `${band[0]}–${band[1]} ${unit}`;

function targetText(step: PlannedStep, sport: PlanSport) {
  if (sport === "ride") {
    if (step.effort === "walk") return "off the bike";
    const zone = rideZone(stepZone(step));
    const band = step.watts
      ? ` ${bandText(step.watts, "W")}`
      : step.bpm
        ? ` ${bandText(step.bpm, "bpm")}`
        : "";
    return `${zone.label}${band}`;
  }
  if (step.pace) {
    const letter = PACE_TYPES.find((pace) => pace.id === step.pace)!.letter;
    if (step.secPerKm != null) return `${letter} ${formatPaceClock(step.secPerKm)} /km`;
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

function stepText(step: PlannedStep, sport: PlanSport) {
  return `${PART_PREFIX[step.part] ?? ""}${stepAmountText(step)} ${targetText(step, sport)}`;
}

/** One line per block, the way the session files write them: "6 × 300 m R …, 300 m jog". */
export function sessionLines(session: Pick<PlannedSession, "blocks" | "sport">) {
  return session.blocks.map((block) => {
    const steps = block.steps.map((step) => stepText(step, session.sport)).join(", ");
    return block.repeat === 1 ? steps : `${block.repeat} × ${steps}`;
  });
}

export function sessionKindLabel(kind: SessionKind, sport: PlanSport = "run") {
  const item = SESSION_KINDS.find((entry) => entry.id === kind);
  return item?.[sport] ?? item?.run ?? item?.ride ?? kind;
}
