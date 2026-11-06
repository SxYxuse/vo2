import { z } from "zod";

import { formatPaceClock } from "./locomotion.ts";
import type { SportSeed, WeekShape } from "./coach-plan-budget.ts";
import type { PhaseKind, SeasonWeek } from "./season-phase.ts";
import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";
import { roughGoalHours, type Goal } from "./season.types.ts";
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
 * plan holds runs, rides, and swims (ADR 0061); walks and other sports count toward load but
 * aren't planned.
 */

export const PLAN_SPORTS = [
  { id: "run", group: "running", label: "Run", plural: "runs" },
  { id: "ride", group: "cycling", label: "Ride", plural: "rides" },
  { id: "swim", group: "swimming", label: "Swim", plural: "swims" },
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
 * How much the athlete can train: runs, rides, and swims a week (ADR 0048, ADR 0050, ADR 0061).
 * Availability saved before rides or swims has none of them; older keys such as days are dropped.
 */
export const availabilitySchema = z
  .object({
    runsPerWeek: z.number().int().min(0).max(MAX_SESSIONS_PER_SPORT),
    ridesPerWeek: z.number().int().min(0).max(MAX_SESSIONS_PER_SPORT).default(0),
    swimsPerWeek: z.number().int().min(0).max(MAX_SESSIONS_PER_SPORT).default(0),
  })
  .refine((value) => value.runsPerWeek + value.ridesPerWeek + value.swimsPerWeek >= 2, {
    error: "Plan at least two sessions a week.",
  });

export type Availability = z.output<typeof availabilitySchema>;

export const DEFAULT_AVAILABILITY: Availability = {
  runsPerWeek: 3,
  ridesPerWeek: 0,
  swimsPerWeek: 0,
};

export function parseAvailability(value: unknown): Availability | null {
  const parsed = availabilitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** An availability as plan bases compare it, so one saved with days reads as without. */
export function availabilityKey(value: unknown) {
  return JSON.stringify(parseAvailability(value));
}

const PER_WEEK_KEY = {
  run: "runsPerWeek",
  ride: "ridesPerWeek",
  swim: "swimsPerWeek",
} as const satisfies Record<PlanSport, keyof Availability>;

export function sessionsPerWeek(availability: Availability, sport: PlanSport) {
  return availability[PER_WEEK_KEY[sport]];
}

/**
 * How fast each sport's weekly budget grows, and the athlete's own peak, when they set one (ADR
 * 0058). Growth is the base phase's weekly %, from Hold (0) to Steep (10); a sport left unset
 * grows at Standard when the A goal is in it and holds otherwise. Peak is in the sport's unit (km
 * of running, minutes of riding, metres of swimming); null is the peak VO2 recommends.
 */
const sportProgressionSchema = (peakLimit: number) =>
  z.object({
    growth: z.number().min(0).max(10).multipleOf(0.5),
    peak: z.number().int().positive().max(peakLimit).nullable(),
  });

/** Peaks up to 200 km of running, 25 h of riding, and 60 km of swimming (PEAK_LIMIT). */
export const progressionSchema = z.object({
  run: sportProgressionSchema(200).optional(),
  ride: sportProgressionSchema(25 * 60).optional(),
  swim: sportProgressionSchema(60_000).optional(),
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

/** "2,400 m": swims are written and budgeted in metres. */
export const metresText = (metres: number) => `${Math.round(metres).toLocaleString("en")} m`;

/** "42 km" of running, "4.5 h" of riding (budgets in minutes), "8,000 m" of swimming. */
export function amountText(sport: PlanSport, amount: number) {
  if (sport === "run") return `${Math.round(amount)} km`;
  if (sport === "swim") return metresText(amount);
  return `${Math.round((amount / 60) * 10) / 10} h`;
}

/** A session's amount in its sport's budget unit: km of running, minutes of riding, metres of swimming. */
export function sessionAmount(session: Pick<PlannedSession, "sport" | "distanceKm" | "minutes">) {
  if (session.sport === "run") return session.distanceKm;
  if (session.sport === "swim") return Math.round(session.distanceKm * 1000);
  return session.minutes;
}

/** A week's budget for a sport. Weeks written before rides or swims have none of theirs. */
export function budgetOf(
  week: Pick<PlanWeek, "budgetKm" | "budgetMinutes" | "budgetSwimM">,
  sport: PlanSport,
) {
  if (sport === "run") return week.budgetKm;
  if (sport === "swim") return week.budgetSwimM ?? 0;
  return week.budgetMinutes ?? 0;
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
  { id: "easy", run: "Easy run", ride: "Endurance ride", swim: "Endurance swim" },
  { id: "recovery", run: "Recovery run", ride: "Recovery ride", swim: "Recovery swim" },
  { id: "long", run: "Long run", ride: "Long ride", swim: "Long swim" },
  { id: "tempo", run: "Threshold", ride: "Threshold", swim: "Threshold" },
  { id: "intervals", run: "Intervals", ride: "VO2 max intervals", swim: "VO2 max set" },
  { id: "repetitions", run: "Repetitions", ride: null, swim: null },
  { id: "hills", run: "Hills", ride: "Climbing", swim: null },
  { id: "fartlek", run: "Fartlek", ride: null, swim: null },
  { id: "marathonPace", run: "Marathon-pace long run", ride: null, swim: null },
  { id: "sweetSpot", run: null, ride: "Sweet spot", swim: null },
  { id: "sprints", run: null, ride: "Sprints", swim: "Sprints" },
  { id: "technique", run: null, ride: null, swim: "Technique" },
  { id: "openWater", run: null, ride: null, swim: "Open water" },
  { id: "race", run: "Race", ride: "Race", swim: "Race" },
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

/**
 * The five efforts of `coaching/running.md`, plus walking for recoveries, with the run pace, ride
 * zone, and swim zone each sits at.
 */
export const EFFORTS = [
  { id: "easy", label: "easy", pace: "easy", zone: "endurance", swimZone: "endurance" },
  { id: "steady", label: "steady", pace: "marathon", zone: "tempo", swimZone: "tempo" },
  {
    id: "comfortablyHard",
    label: "comfortably hard",
    pace: "threshold",
    zone: "threshold",
    swimZone: "threshold",
  },
  { id: "hard", label: "hard", pace: "interval", zone: "vo2max", swimZone: "vo2max" },
  {
    id: "fastRelaxed",
    label: "fast and relaxed",
    pace: "repetition",
    zone: "anaerobic",
    swimZone: "sprint",
  },
  { id: "walk", label: "walk", pace: null, zone: null, swimZone: null },
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

/**
 * Swim zones a swim step targets (`coaching/swimming.md`, ADR 0061): offsets from the athlete's
 * CSS, the critical swim speed, in seconds per 100 m, fast then slow (a positive offset is slower
 * than CSS). They share the ride zones' ids, so a step keeps one `zone` field. Sprint is all-out:
 * no pace to hold.
 */
export const SWIM_ZONES = [
  { id: "recovery", label: "recovery", level: 1, css: [11, 20] },
  { id: "endurance", label: "endurance", level: 2, css: [6, 10] },
  { id: "tempo", label: "tempo", level: 3, css: [3, 5] },
  { id: "threshold", label: "threshold", level: 4, css: [-1, 2] },
  { id: "vo2max", label: "VO2 max", level: 5, css: [-6, -2] },
  { id: "sprint", label: "all-out sprint", level: 5, css: null },
] as const satisfies readonly {
  id: RideZone;
  label: string;
  level: number;
  css: readonly [number, number] | null;
}[];

export const swimZoneOf = (id: RideZone | null) =>
  SWIM_ZONES.find((zone) => zone.id === id) ?? null;

/**
 * Drills a step may name, by sport (ADR 0063): what the athlete does in the step, beside its
 * distance and effort. Swims only for now; another sport's drills join the same list with their
 * own sport, and the rule checker keeps each drill to its sport.
 */
export const DRILLS = [
  {
    id: "catchUp",
    sport: "swim",
    label: "catch-up drill",
    how: "Freestyle with one hand waiting out front until the other arrives to touch it, then that arm strokes. Trains a long body line and a full stroke.",
    kit: null,
  },
  {
    id: "singleArm",
    sport: "swim",
    label: "single-arm drill",
    how: "Freestyle with one arm only, the other resting out front or at your side; breathe to the stroking side. Swap arms each length. Trains the catch and rotation.",
    kit: null,
  },
  {
    id: "sixKickSwitch",
    sport: "swim",
    label: "6-kick switch drill",
    how: "Kick six times on your side, bottom arm out front, then take one stroke to roll onto the other side. Trains rotation and balance.",
    kit: null,
  },
  {
    id: "fist",
    sport: "swim",
    label: "fist drill",
    how: "Freestyle with closed fists, so the forearm has to hold the water. Trains an early, high-elbow catch; open the hands for the last length to feel the difference.",
    kit: null,
  },
  {
    id: "sculling",
    sport: "swim",
    label: "sculling",
    how: "Face down, arms out front, sweep the hands in and out in small figures of eight to move forward with a light kick. Trains feel for the water.",
    kit: null,
  },
  {
    id: "kickOnSide",
    sport: "swim",
    label: "kick on the side",
    how: "Kick on your side, bottom arm out front, top arm along your body, rolling the face up to breathe. Trains balance and body position.",
    kit: null,
  },
  {
    id: "kick",
    sport: "swim",
    label: "kick with a board",
    how: "Hold a kickboard out front and kick from the hips with loose ankles and straight-ish knees. Trains the legs and a high body position.",
    kit: "Kickboard",
  },
  {
    id: "pull",
    sport: "swim",
    label: "pull with a buoy",
    how: "Freestyle with a pull buoy between your thighs and no kick, so the arms do the work. Trains the pull.",
    kit: "Pull buoy",
  },
] as const satisfies readonly {
  id: string;
  sport: PlanSport;
  label: string;
  how: string;
  kit: string | null;
}[];

export type Drill = (typeof DRILLS)[number]["id"];
const DRILL_IDS = DRILLS.map((drill) => drill.id) as [Drill, ...Drill[]];
export const drillOf = (id: Drill | null | undefined) =>
  DRILLS.find((drill) => drill.id === id) ?? null;

/** The drills a session's steps name, each once, in the order they come. */
export function sessionDrills(session: Pick<PlannedSession, "blocks">) {
  const ids = new Set(session.blocks.flatMap((block) => block.steps.map((step) => step.drill)));
  return [...ids].map(drillOf).filter((drill) => drill != null);
}

export const STEP_PARTS = ["warmup", "work", "recovery", "cooldown"] as const;
export type StepPart = (typeof STEP_PARTS)[number];

/**
 * One step: a distance or a time, and a target. A run targets a pace type or an effort; a ride
 * targets a zone or an effort, by time only. A run step at a pace harder than easy also names one
 * pace in seconds per km, inside its pace type's range or at a goal's race pace (ADR 0055). A swim
 * step is a distance at a swim zone or an effort, or rest at the wall: a recovery step by time
 * (ADR 0061), and may name a swim drill to do in it, at an easy effort (ADR 0063). Kept flat,
 * without refinements, so every structured-output model reads it the same way; the rule checker
 * reports a step that mixes them (coach-plan-rules.ts).
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
  drill: z.enum(DRILL_IDS).nullable(),
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
  // Four weeks of six runs, six rides, and six swims.
  sessions: z.array(writtenSessionSchema).max(4 * MAX_SESSIONS_PER_SPORT * PLAN_SPORTS.length),
});

export type Step = z.infer<typeof stepSchema>;
export type WrittenSession = z.infer<typeof writtenSessionSchema>;
export type WrittenPlan = z.infer<typeof writtenPlanSchema>;

/** Watts or bpm, low to high. */
export type Band = [number, number];

/**
 * A step as stored, with what it targets in the athlete's numbers when it was written: a run's
 * pace range, a ride zone's watts from FTP and, below VO2 max, its heart rate from LTHR, or a swim
 * zone's pace per 100 m from CSS.
 */
export type PlannedStep = Step & {
  range: PaceRange | null;
  watts?: Band | null;
  bpm?: Band | null;
  /** Seconds per 100 m, fast then slow. */
  swimPace?: Band | null;
};

/**
 * A session as stored, with its size worked out by VO2, not the model: a run's or a swim's
 * distance and time, a ride's time (its distance is 0: rides are planned by time).
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
  /** VO2's weekly swimming budget, in metres (rule 1). Plans written before swims have none. */
  budgetSwimM?: number;
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
  /** CSS in seconds per 100 m (ADR 0061). Plans written before swims have none. */
  css?: number | null;
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
  /** The upcoming A run, ride, or swim with a distance the plan builds toward. */
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

/**
 * The A goal the coach plan builds toward: the next A run, ride, or swim with a distance. Of a
 * multisport event's legs, the longest by time leads (a triathlon's ride), so its taper is the
 * event's.
 */
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
      .sort((a, b) => a.date.localeCompare(b.date) || roughGoalHours(b) - roughGoalHours(a))[0] ??
    null
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

/**
 * CSS assumed when the athlete has none, in seconds per 100 m: a recreational swimmer's, used only
 * to estimate a swim's time.
 */
const NO_CSS_SEC_PER_100M = 125;
/** A sprint has no pace to hold; it is counted this much faster than CSS. */
const SPRINT_CSS_OFFSET = -8;

/** The zone a swim step swims at: its own, or the one its effort sits at. */
export function stepSwimZone(step: Pick<Step, "zone" | "effort">) {
  const effort = EFFORTS.find((item) => item.id === step.effort)?.swimZone ?? null;
  return swimZoneOf(step.zone) ?? swimZoneOf(effort) ?? swimZoneOf("endurance")!;
}

/** The seconds per 100 m a swim step is counted at: the middle of its zone around CSS. */
export function swimSecPer100m(step: Pick<Step, "zone" | "effort">, css: number | null) {
  const zone = stepSwimZone(step);
  const offset = zone.css ? (zone.css[0] + zone.css[1]) / 2 : SPRINT_CSS_OFFSET;
  return (css ?? NO_CSS_SEC_PER_100M) + offset;
}

/**
 * A swim step with no distance is rest at the wall: it takes time, swims no metres (ADR 0061).
 */
const isRest = (step: Pick<Step, "distanceM">) => step.distanceM == null;

/**
 * A session's distance (km) and time (minutes), from its steps; a ride's distance is 0. A swim's
 * distance is kept to the metre: pool sets come in lengths, not tenths of a km.
 */
export function sessionSize(
  sport: PlanSport,
  blocks: { repeat: number; steps: Step[] }[],
  anchors: Pick<PlanAnchors, "paces" | "css">,
) {
  let metres = 0;
  let seconds = 0;
  for (const block of blocks) {
    for (const step of block.steps) {
      let stepMetres: number;
      let stepSeconds: number;
      if (sport === "swim") {
        stepMetres = step.distanceM ?? 0;
        stepSeconds = isRest(step)
          ? (step.durationS ?? 0)
          : (stepMetres / 100) * swimSecPer100m(step, anchors.css);
      } else {
        const secPerKm = sport === "ride" ? 3600 / RIDE_KMH : stepSecPerKm(step, anchors.paces);
        stepMetres = step.distanceM ?? ((step.durationS ?? 0) / secPerKm) * 1000;
        stepSeconds = step.durationS ?? ((step.distanceM ?? 0) / 1000) * secPerKm;
      }
      metres += stepMetres * block.repeat;
      seconds += stepSeconds * block.repeat;
    }
  }
  const distanceKm =
    sport === "ride"
      ? 0
      : sport === "swim"
        ? Math.round(metres) / 1000
        : Math.round(metres / 100) / 10;
  return { distanceKm, minutes: Math.round(seconds / 60) };
}

/** What a planned step is aimed at, in the athlete's own numbers. */
export type PlanAnchors = {
  paces: Record<PaceType, PaceRange> | null;
  /** FTP in watts, for ride zones. */
  ftp: number | null;
  /** Cycling LTHR, for ride zones without power. */
  rideLthr: number | null;
  /** CSS in seconds per 100 m, for swim zones (ADR 0061). */
  css: number | null;
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

/** A swim zone's pace per 100 m from CSS, fast then slow; none for a sprint or rest. */
function swimTarget(step: Step, css: number | null): Band | null {
  // A drill is swum by feel: its pace says nothing about the drill done well.
  if (css == null || isRest(step) || step.drill != null) return null;
  const zone = stepSwimZone(step);
  return zone.css ? [Math.round(css + zone.css[0]), Math.round(css + zone.css[1])] : null;
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
      if (session.sport === "swim") {
        return { ...step, range: null, swimPace: swimTarget(step, anchors.css) };
      }
      return { ...step, range: step.pace && paces ? paces[step.pace] : null };
    }),
  }));
  return {
    ...session,
    id,
    blocks,
    ...sessionSize(session.sport, session.blocks, anchors),
    done: false,
  };
}

/** "800 m", "2.5 km", "90 s", "20 min", "1 h 30"; a swim's distance always in metres, "1,500 m". */
export function stepAmountText(step: Step, sport?: PlanSport) {
  if (step.distanceM != null && sport === "swim") return metresText(step.distanceM);
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

/** A session's headline size: a run's distance, a ride's time, a swim's metres. */
export function sessionAmountText(
  session: Pick<PlannedSession, "sport" | "distanceKm" | "minutes">,
) {
  if (session.sport === "ride") return minutesText(session.minutes);
  if (session.sport === "swim") return metresText(session.distanceKm * 1000);
  return `${session.distanceKm} km`;
}

export const bandText = (band: Band, unit: string) => `${band[0]}–${band[1]} ${unit}`;

/** "1:42–1:45 /100m", fast then slow. */
export const swimPaceText = (band: Band) =>
  `${formatPaceClock(band[0])}–${formatPaceClock(band[1])} /100m`;

/**
 * A swim step's target: rest, a drill at its effort (a drill is swum by feel, not at a pace), or
 * its zone and its pace per 100 m when VO2 has a CSS.
 */
export function swimTargetText(step: PlannedStep, join = " ") {
  if (isRest(step)) return "rest";
  const zone = stepSwimZone(step);
  const drill = drillOf(step.drill);
  if (drill) {
    const effort = EFFORTS.find((item) => item.id === step.effort)?.label ?? zone.label;
    return `${drill.label}, ${effort}`;
  }
  return step.swimPace ? `${zone.label}${join}${swimPaceText(step.swimPace)}` : zone.label;
}

function targetText(step: PlannedStep, sport: PlanSport) {
  if (sport === "swim") return swimTargetText(step);
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
  return `${PART_PREFIX[step.part] ?? ""}${stepAmountText(step, sport)} ${targetText(step, sport)}`;
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
  return item?.[sport] ?? item?.run ?? item?.ride ?? item?.swim ?? kind;
}
