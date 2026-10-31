import { z } from "zod";

/*
 * Daniels and Gilbert's running model (Oxygen Power, 1979), as printed by the Daniels calculator
 * at rundida.com: the oxygen cost of a speed, and the share of VO2max a runner holds for a time.
 * VDOT is a race's oxygen cost divided by that share. All three terms of the share are needed:
 * a 40-minute 10 km gives about 51.9 only with the last one.
 */

/** Oxygen cost (ml/kg/min) of running at `speed` metres per minute. */
function oxygenCost(speed: number) {
  return -4.6 + 0.182258 * speed + 0.000104 * speed * speed;
}

/** Share of VO2max a runner holds for `minutes`. */
function sustainableShare(minutes: number) {
  return (
    0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}

/** Speed (metres per minute) whose oxygen cost is `vo2`: the cost equation solved for speed. */
function speedForOxygen(vo2: number) {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** The VDOT a run of `metres` in `seconds` stands for. */
export function vdotFromRace(metres: number, seconds: number) {
  const minutes = seconds / 60;
  return oxygenCost(metres / minutes) / sustainableShare(minutes);
}

/** Seconds a runner of `vdot` is predicted to need for `metres`: the model solved for time. */
export function predictRaceSeconds(vdot: number, metres: number) {
  // VDOT falls as the time grows, so halving the bracket converges on the one time that fits.
  let fast = 1;
  let slow = 24 * 3600;
  for (let step = 0; step < 60; step += 1) {
    const mid = (fast + slow) / 2;
    if (vdotFromRace(metres, mid) > vdot) fast = mid;
    else slow = mid;
  }
  return Math.round((fast + slow) / 2);
}

/**
 * The model is fitted to races of about 3.5 minutes to 4 hours (Riegel's range for the same kind
 * of curve), so it predicts from 1,500 m, about the shortest race that long, to the marathon;
 * ultras are left without a number.
 */
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

/** A pace range in seconds per km, slowest first. */
export type PaceRange = { slowSecPerKm: number; fastSecPerKm: number };

/**
 * Each pace as a share of VDOT, from Daniels' FAQ (rundida.com) where it gives one: threshold
 * 83–88 %, interval 95–100 %, repetition 105–110 %. Threshold keeps only its top, 85–88 %, so it
 * no longer overlaps marathon pace; 88 % gives 4:15/km at VDOT 50, Daniels' own T pace. Easy is
 * 62–70 %, narrower than the FAQ's 59–74 %: at VDOT 50 it gives about 5:07–5:38/km, close to the
 * published tables, where the FAQ's band would reach within 20 s of marathon pace.
 */
const SHARE_OF_VDOT: Record<Exclude<PaceType, "marathon">, [number, number]> = {
  easy: [0.62, 0.7],
  threshold: [0.85, 0.88],
  interval: [0.95, 1],
  repetition: [1.05, 1.1],
};

/** Marathon pace is a race pace, not a share: the predicted marathon, give or take 1.5 %. */
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

/** Race distances (metres) the athlete can set a result for: the race distances of best efforts. */
export const RACE_DISTANCES = [1609.344, 5000, 10_000, 21_097.5, 42_195] as const;

/** Daniels' tables run from about 30 to 85; outside a wider band a result is a typo. */
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

/** One run's best effort, as read for the estimate. */
export type RunEffort = {
  activityId: string;
  name: string;
  start: string;
  metres: number;
  seconds: number;
};

/**
 * Best efforts from the last 16 weeks count, each worth 1 % less per week of age, so an old best
 * fades a little every day and is close to ordinary training by the time it leaves the window.
 * Both numbers are VO2's choice: no source gives a decay rate for best efforts.
 */
export const ESTIMATE_WINDOW_DAYS = 16 * 7;
const AGE_DISCOUNT_PER_WEEK = 0.01;
/** Shorter bests are sprints the model doesn't fit, and inflate VDOT. */
const ESTIMATE_MIN_M = 1600;
/** One run can lift the estimate at most this far above the next-best run. */
const OUTLIER_LIFT = 1.05;

export type PaceEstimate = {
  vdot: number;
  /** The best effort the estimate stands on. */
  from: RunEffort;
  /** Whether it was held to the next-best run because it stood too far above it. */
  capped: boolean;
};

/**
 * Current fitness from best efforts inside recent road runs. Each run counts once, by its best
 * effort of a mile or more, discounted by its age. The best run sets the estimate, but at most
 * 5 % above the next-best one, so a GPS slip or a single unusual day can't move every pace at
 * once; with only one run there is nothing to check it against, so there is no estimate yet.
 * Best efforts inside training runs are a floor, not a race, so the estimate errs slow.
 */
export function estimateVdot(efforts: RunEffort[], now: Date): PaceEstimate | null {
  const bestPerRun = new Map<string, { effort: RunEffort; vdot: number }>();
  for (const effort of efforts) {
    if (effort.metres < ESTIMATE_MIN_M) continue;
    const weeks = Math.max(0, now.getTime() - Date.parse(effort.start)) / (7 * 86_400_000);
    const vdot = vdotFromRace(effort.metres, effort.seconds) * (1 - AGE_DISCOUNT_PER_WEEK * weeks);
    const current = bestPerRun.get(effort.activityId);
    if (!current || vdot > current.vdot) bestPerRun.set(effort.activityId, { effort, vdot });
  }
  const ranked = [...bestPerRun.values()].sort((a, b) => b.vdot - a.vdot);
  if (ranked.length < 2) return null;
  const [best, next] = ranked as [(typeof ranked)[0], (typeof ranked)[0]];
  const ceiling = next.vdot * OUTLIER_LIFT;
  const capped = best.vdot > ceiling;
  return { vdot: roundVdot(capped ? ceiling : best.vdot), from: best.effort, capped };
}

/**
 * A race result sets the paces for as long as best efforts count, then stops, since it no
 * longer says much about fitness now; it stays saved and shown until the athlete clears it.
 */
export function isRaceResultCurrent(raceResult: RaceResult, now: Date) {
  const oldest = new Date(now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000);
  return raceResult.date >= oldest.toISOString().slice(0, 10);
}

export function roundVdot(vdot: number) {
  return Math.round(vdot * 10) / 10;
}

export type TrainingPaces =
  | {
      signedIn: boolean;
      source: "none";
      /** A saved race result too old to set the paces any more. */
      raceResult: RaceResult | null;
      estimate: null;
    }
  | {
      signedIn: true;
      /** A race result the athlete set wins over the estimate from best efforts. */
      source: "race" | "estimate";
      vdot: number;
      paces: Record<PaceType, PaceRange>;
      raceResult: RaceResult | null;
      estimate: PaceEstimate | null;
    };

/** The athlete's training paces: their race result while current, else the estimate. */
export function trainingPaces(
  raceResult: RaceResult | null,
  estimate: PaceEstimate | null,
  now: Date,
): TrainingPaces {
  const race = raceResult && isRaceResultCurrent(raceResult, now) ? raceResult : null;
  const vdot = race ? roundVdot(vdotFromRace(race.metres, race.seconds)) : estimate?.vdot;
  if (vdot == null) return { signedIn: true, source: "none", raceResult, estimate: null };
  return {
    signedIn: true,
    source: race ? "race" : "estimate",
    vdot,
    paces: trainingPaceRanges(vdot),
    raceResult,
    estimate,
  };
}

/** Goals of these sport types get a predicted race time: road running, where pace carries. */
export function predictsRaceTime(sportType: string) {
  return sportType === "Run";
}

/** Seconds from a typed race time, "mm:ss" or "h:mm:ss"; null when it doesn't read as one. */
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
