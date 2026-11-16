import { z } from "zod";

/*
 * Daniels and Gilbert's running model (Oxygen Power, 1979), as printed by the Daniels calculator
 * at rundida.com: the oxygen cost of a speed, and the share of VO2max a runner holds for a time.
 * VDOT is a race's oxygen cost divided by that share. All three terms of the share are needed:
 * a 40-minute 10 km gives about 51.9 only with the last one.
 */

function oxygenCost(speed: number) {
  return -4.6 + 0.182258 * speed + 0.000104 * speed * speed;
}

function sustainableShare(minutes: number) {
  return (
    0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}

function speedForOxygen(vo2: number) {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function vdotFromRace(metres: number, seconds: number) {
  const minutes = seconds / 60;
  return oxygenCost(metres / minutes) / sustainableShare(minutes);
}

export function predictRaceSeconds(vdot: number, metres: number) {
  let fast = 1;
  let slow = 24 * 3600;
  for (let step = 0; step < 60; step += 1) {
    const mid = (fast + slow) / 2;
    if (vdotFromRace(metres, mid) > vdot) fast = mid;
    else slow = mid;
  }
  return Math.round((fast + slow) / 2);
}

export const PREDICTION_MIN_M = 1500;
export const PREDICTION_MAX_M = 42_500;

export function canPredict(metres: number) {
  return metres >= PREDICTION_MIN_M && metres <= PREDICTION_MAX_M;
}

export const PACE_TYPES = [
  {
    id: "easy",
    letter: "E",
    label: "Easy",
    hint: "Warm-ups, recovery, and most of the week. Run it by feel when tired, hot, or hilly.",
  },
  {
    id: "marathon",
    letter: "M",
    label: "Marathon",
    hint: "Your predicted marathon pace, for steady blocks inside long runs.",
  },
  {
    id: "threshold",
    letter: "T",
    label: "Threshold",
    hint: "Comfortably hard: 20 minutes steady, or 5-minute repeats with a minute's jog.",
  },
  {
    id: "interval",
    letter: "I",
    label: "Interval",
    hint: "Hard repeats of 3 to 5 minutes, such as 5 × 1,000 m with equal jog recovery.",
  },
  {
    id: "repetition",
    letter: "R",
    label: "Repetition",
    hint: "Fast, relaxed 200 m and 400 m repeats with full recovery.",
  },
] as const;

export type PaceType = (typeof PACE_TYPES)[number]["id"];

export type PaceRange = { slowSecPerKm: number; fastSecPerKm: number };

const SHARE_OF_VDOT: Record<Exclude<PaceType, "marathon">, [number, number]> = {
  easy: [0.62, 0.7],
  threshold: [0.85, 0.88],
  interval: [0.95, 1],
  repetition: [1.05, 1.1],
};

const MARATHON_SPREAD = 0.015;
const MARATHON_M = 42_195;

const secondsPerKm = (metresPerMinute: number) => Math.round(60_000 / metresPerMinute);

export function trainingPaceRanges(vdot: number): Record<PaceType, PaceRange> {
  const range = ([low, high]: [number, number]): PaceRange => ({
    slowSecPerKm: secondsPerKm(speedForOxygen(vdot * low)),
    fastSecPerKm: secondsPerKm(speedForOxygen(vdot * high)),
  });
  const marathon = predictRaceSeconds(vdot, MARATHON_M) / (MARATHON_M / 1000);
  return {
    easy: range(SHARE_OF_VDOT.easy),
    marathon: {
      slowSecPerKm: Math.round(marathon * (1 + MARATHON_SPREAD)),
      fastSecPerKm: Math.round(marathon * (1 - MARATHON_SPREAD)),
    },
    threshold: range(SHARE_OF_VDOT.threshold),
    interval: range(SHARE_OF_VDOT.interval),
    repetition: range(SHARE_OF_VDOT.repetition),
  };
}

export const RACE_DISTANCES = [1609.344, 5000, 10_000, 21_097.5, 42_195] as const;

const VDOT_MIN = 20;
const VDOT_MAX = 90;

export const raceResultSchema = z
  .object({
    metres: z.union(RACE_DISTANCES.map((metres) => z.literal(metres))),
    seconds: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date." }),
  })
  .refine(
    (race) => {
      const vdot = vdotFromRace(race.metres, race.seconds);
      return vdot >= VDOT_MIN && vdot <= VDOT_MAX;
    },
    { error: "That time is outside what VO2 can read paces from.", path: ["seconds"] },
  );

export type RaceResult = z.infer<typeof raceResultSchema>;

export function parseRaceResult(value: unknown): RaceResult | null {
  const parsed = raceResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const runEffortSchema = z.object({
  activityId: z.string().min(1),
  name: z.string(),
  start: z.iso.datetime({ offset: true }),
  metres: z.number().positive(),
  seconds: z.number().positive(),
});

export type RunEffort = z.infer<typeof runEffortSchema>;

export const PACES_FROM = ["automatic", "effort", "race"] as const;
export type PacesFrom = (typeof PACES_FROM)[number];

export const EASY_FROM = ["heartRate", "vdot"] as const;
export type EasyFrom = (typeof EASY_FROM)[number];

const paceSettingsSchema = z.object({
  from: z.enum(PACES_FROM).optional(),
  effort: runEffortSchema.nullable().default(null),
  easyFrom: z.enum(EASY_FROM).default("heartRate"),
});

export type PaceSettings = z.infer<typeof paceSettingsSchema>;

export function parsePaceSettings(value: unknown): PaceSettings {
  const parsed = paceSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : paceSettingsSchema.parse({});
}

export const paceChoiceSchema = z.union([
  z.object({ from: z.literal("automatic") }),
  z.object({ from: z.literal("effort"), activityId: z.string().min(1), metres: z.number() }),
  z.object({ easyFrom: z.enum(EASY_FROM) }),
]);

export type PaceChoice = z.infer<typeof paceChoiceSchema>;

export const ESTIMATE_WINDOW_DAYS = 16 * 7;
const AGE_DISCOUNT_PER_WEEK = 0.01;
const ESTIMATE_MIN_M = 1600;
const PREFERRED_MIN_M = 3000;
export const DEFAULT_TARGET_M = 10_000;
const OUTLIER_LIFT = 1.05;

export type PaceEstimate = {
  vdot: number;
  from: RunEffort;
  capped: boolean;
  targetMetres: number;
};

const weeksOld = (start: string, now: Date) =>
  Math.max(0, now.getTime() - Date.parse(start)) / (7 * 86_400_000);

const distanceGap = (metres: number, target: number) => Math.abs(Math.log(metres / target));

const VDOT_TIE = 0.05;

function estimateFrom(efforts: RunEffort[], now: Date, targetMetres: number): PaceEstimate | null {
  type Scored = { effort: RunEffort; vdot: number };
  const stronger = (a: Scored, b: Scored) =>
    Math.abs(a.vdot - b.vdot) > VDOT_TIE
      ? b.vdot - a.vdot
      : distanceGap(a.effort.metres, targetMetres) - distanceGap(b.effort.metres, targetMetres);
  const bestPerRun = new Map<string, Scored>();
  for (const effort of efforts) {
    const scored = {
      effort,
      vdot:
        vdotFromRace(effort.metres, effort.seconds) *
        (1 - AGE_DISCOUNT_PER_WEEK * weeksOld(effort.start, now)),
    };
    const current = bestPerRun.get(effort.activityId);
    if (!current || stronger(scored, current) < 0) bestPerRun.set(effort.activityId, scored);
  }
  const ranked = [...bestPerRun.values()].sort(stronger);
  if (ranked.length < 2) return null;
  const [best, next] = ranked as [Scored, Scored];
  const ceiling = next.vdot * OUTLIER_LIFT;
  const capped = best.vdot > ceiling;
  return { vdot: roundVdot(capped ? ceiling : best.vdot), from: best.effort, capped, targetMetres };
}

export function estimateVdot(
  efforts: RunEffort[],
  now: Date,
  targetMetres = DEFAULT_TARGET_M,
): PaceEstimate | null {
  const counted = efforts.filter((effort) => effort.metres >= ESTIMATE_MIN_M);
  const preferred = counted.filter((effort) => effort.metres >= PREFERRED_MIN_M);
  const runsHolding = new Set(preferred.map((effort) => effort.activityId)).size;
  return estimateFrom(runsHolding >= 2 ? preferred : counted, now, targetMetres);
}

export type TrendPoint = { at: Date; vdot: number | null; seconds: number | null };

export function predictedTimeTrend(
  efforts: RunEffort[],
  asOf: Date[],
  targetMetres: number,
): TrendPoint[] {
  return asOf.map((at) => {
    const oldest = at.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000;
    const counted = efforts.filter((effort) => {
      const start = Date.parse(effort.start);
      return start >= oldest && start <= at.getTime();
    });
    const estimate = estimateVdot(counted, at, targetMetres);
    if (!estimate) return { at, vdot: null, seconds: null };
    return { at, vdot: estimate.vdot, seconds: predictRaceSeconds(estimate.vdot, targetMetres) };
  });
}

export type TrendTarget =
  | { kind: "goal"; name: string }
  | { kind: "none" }
  | { kind: "unpredicted"; name: string };

export type TrendWeek = { date: string; vdot: number | null; seconds: number | null };
type EstimatedWeek = { date: string; vdot: number; seconds: number };

export type PredictedTimeTrend = {
  metres: number;
  target: TrendTarget;
  pacesFrom: "automatic" | "effort" | "race";
  points: TrendWeek[];
};

function isEstimated(week: TrendWeek): week is EstimatedWeek {
  return week.vdot != null && week.seconds != null;
}

export function trendChange(points: TrendWeek[]) {
  const estimated = points.filter(isEstimated);
  const first = estimated[0];
  const last = estimated.at(-1);
  if (!first || !last) return null;
  if (first === last) return { first: null, last, weeks: 0 };
  const days = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000;
  return { first, last, weeks: Math.round(days / 7) };
}

function isInWindow(date: string, now: Date) {
  const oldest = new Date(now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000);
  return date.slice(0, 10) >= oldest.toISOString().slice(0, 10);
}

export function isRaceResultCurrent(raceResult: RaceResult, now: Date) {
  return isInWindow(raceResult.date, now);
}

export function roundVdot(vdot: number) {
  return Math.round(vdot * 10) / 10;
}

export const EFFORT_CHOICE_DISTANCES = RACE_DISTANCES;

export type EffortChoice = {
  metres: number;
  recent: RunEffort | null;
  allTime: RunEffort | null;
};

export function effortChoices(efforts: RunEffort[], now: Date): EffortChoice[] {
  const fastest = (list: RunEffort[]) =>
    list.reduce<RunEffort | null>(
      (best, effort) => (!best || effort.seconds < best.seconds ? effort : best),
      null,
    );
  return EFFORT_CHOICE_DISTANCES.flatMap((metres) => {
    const atDistance = efforts.filter((effort) => effort.metres === metres);
    const allTime = fastest(atDistance);
    if (!allTime) return [];
    const recent = fastest(atDistance.filter((effort) => isInWindow(effort.start, now)));
    return [{ metres, recent, allTime }];
  });
}

export type EasyFromHeart =
  | { kind: "zones-missing" }
  | {
      kind: "zone2";
      minBpm: number;
      maxBpm: number;
      minutes: number;
      range: PaceRange | null;
    };

type PaceSetup = {
  from: PacesFrom;
  raceResult: RaceResult | null;
  effort: RunEffort | null;
  suggestion: RunEffort | null;
  choices: EffortChoice[];
  estimate: PaceEstimate | null;
  easyFrom: EasyFrom;
  heart: EasyFromHeart;
};

export type TrainingPaces = PaceSetup &
  (
    | { signedIn: boolean; source: "none" }
    | {
        signedIn: true;
        source: "race" | "effort" | "estimate";
        vdot: number;
        paces: Record<PaceType, PaceRange>;
        easySource: EasyFrom;
        zone2TooFast: boolean;
      }
  );

export const NO_PACES: TrainingPaces = {
  signedIn: false,
  source: "none",
  from: "automatic",
  raceResult: null,
  effort: null,
  suggestion: null,
  choices: [],
  estimate: null,
  easyFrom: "heartRate",
  heart: { kind: "zones-missing" },
};

export function activePacesFrom(
  settings: PaceSettings,
  raceResult: RaceResult | null,
  now: Date,
): PacesFrom {
  const from = settings.from ?? (raceResult ? "race" : "automatic");
  if (from === "effort" && settings.effort) return "effort";
  if (from === "race" && raceResult && isRaceResultCurrent(raceResult, now)) return "race";
  return "automatic";
}

export function trainingPaces(input: {
  settings: PaceSettings;
  raceResult: RaceResult | null;
  estimate: PaceEstimate | null;
  choices: EffortChoice[];
  heart: EasyFromHeart;
  now: Date;
}): TrainingPaces {
  const { settings, raceResult, estimate, choices, heart, now } = input;
  const from = settings.from ?? (raceResult ? "race" : "automatic");
  const active = activePacesFrom(settings, raceResult, now);
  const effort = active === "effort" ? settings.effort : null;
  const race = active === "race" ? raceResult : null;
  const picked = effort ?? race;
  const vdot = picked ? roundVdot(vdotFromRace(picked.metres, picked.seconds)) : estimate?.vdot;
  const newer = effort ? choices.find((choice) => choice.metres === effort.metres)?.recent : null;
  const setup: PaceSetup = {
    from,
    raceResult,
    effort,
    suggestion:
      effort && !isInWindow(effort.start, now) && newer && newer.activityId !== effort.activityId
        ? newer
        : null,
    choices,
    estimate,
    easyFrom: settings.easyFrom,
    heart,
  };
  if (vdot == null) return { ...setup, signedIn: true, source: "none" };
  const paces = trainingPaceRanges(vdot);
  const found = settings.easyFrom === "heartRate" && heart.kind === "zone2" ? heart.range : null;
  const zone2TooFast = found != null && found.fastSecPerKm < paces.marathon.slowSecPerKm;
  const zone2 = zone2TooFast ? null : found;
  return {
    ...setup,
    signedIn: true,
    source: effort ? "effort" : race ? "race" : "estimate",
    vdot,
    paces: zone2 ? { ...paces, easy: zone2 } : paces,
    easySource: zone2 ? "heartRate" : "vdot",
    zone2TooFast,
  };
}

export function predictsRaceTime(sportType: string) {
  return sportType === "Run";
}

export function parseRaceTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const [seconds, minutes, hours = 0] = parts.map(Number).reverse() as [number, number, number?];
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}
