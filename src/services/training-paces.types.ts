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

/** One run's best effort, as read for the estimate and offered to pick. */
export const runEffortSchema = z.object({
  activityId: z.string().min(1),
  name: z.string(),
  start: z.iso.datetime({ offset: true }),
  metres: z.number().positive(),
  seconds: z.number().positive(),
});

export type RunEffort = z.infer<typeof runEffortSchema>;

/** What the training paces are read from: the estimate, a picked best effort, or a race. */
export const PACES_FROM = ["automatic", "effort", "race"] as const;
export type PacesFrom = (typeof PACES_FROM)[number];

/** What the easy pace is read from: zone 2 heart rate, or the VDOT like the other paces. */
export const EASY_FROM = ["heartRate", "vdot"] as const;
export type EasyFrom = (typeof EASY_FROM)[number];

const paceSettingsSchema = z.object({
  /** Unset for athletes from before the choice: their race result, if any, keeps setting paces. */
  from: z.enum(PACES_FROM).optional(),
  effort: runEffortSchema.nullable().default(null),
  easyFrom: z.enum(EASY_FROM).default("heartRate"),
});

export type PaceSettings = z.infer<typeof paceSettingsSchema>;

export function parsePaceSettings(value: unknown): PaceSettings {
  const parsed = paceSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : paceSettingsSchema.parse({});
}

/** What the athlete can change on the Paces page, one choice at a time. */
export const paceChoiceSchema = z.union([
  z.object({ from: z.literal("automatic") }),
  z.object({ from: z.literal("effort"), activityId: z.string().min(1), metres: z.number() }),
  z.object({ easyFrom: z.enum(EASY_FROM) }),
]);

export type PaceChoice = z.infer<typeof paceChoiceSchema>;

/**
 * Best efforts from the last 16 weeks count, each worth 1 % less per week of age, so an old best
 * fades a little every day and is close to ordinary training by the time it leaves the window.
 * Both numbers are VO2's choice: no source gives a decay rate for best efforts.
 */
export const ESTIMATE_WINDOW_DAYS = 16 * 7;
const AGE_DISCOUNT_PER_WEEK = 0.01;
/** Shorter bests are sprints the model doesn't fit, and inflate VDOT. */
const ESTIMATE_MIN_M = 1600;
/**
 * Efforts this long are preferred: a mile or a 6-minute test sits where the model over-reads
 * longer races, so only 2-mile best efforts or longer count whenever two runs hold one.
 */
const PREFERRED_MIN_M = 3000;
/** The distance near ties lean toward without a running A goal. */
export const DEFAULT_TARGET_M = 10_000;
/** One run can lift the estimate at most this far above the next-best run. */
const OUTLIER_LIFT = 1.05;

export type PaceEstimate = {
  vdot: number;
  /** The best effort the estimate stands on. */
  from: RunEffort;
  /** Whether it was held to the next-best run because it stood too far above it. */
  capped: boolean;
  /** The distance near ties leaned toward: the A goal's, or 10 km. */
  targetMetres: number;
};

const weeksOld = (start: string, now: Date) =>
  Math.max(0, now.getTime() - Date.parse(start)) / (7 * 86_400_000);

/** How far apart two distances are, by ratio: 5 km is as far from 10 km as 10 km from 20 km. */
const distanceGap = (metres: number, target: number) => Math.abs(Math.log(metres / target));

/** VDOTs this close are a tie, broken by the distance closer to the target. */
const VDOT_TIE = 0.05;

/**
 * The estimate from one pool (ADR 0039's rule): each run counts once, by its best effort
 * discounted by age; the best run sets it, at most 5 % above the next-best run. The target
 * distance only breaks near ties, within a run and between runs: it never picks a distance.
 */
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

/**
 * Current fitness from best efforts inside recent road runs (ADR 0039, ADR 0042). Each run counts
 * once, by its best effort of 3 km or more when two runs hold one, else of a mile or more, so a
 * mile-long test can't set every pace. The best run sets the estimate, discounted by its age and
 * at most 5 % above the next-best run, so a GPS slip or a single unusual day can't move every
 * pace at once. The A goal's distance (10 km without one) only breaks near ties. With fewer than
 * two runs there is nothing to check against, so no estimate. Best efforts inside training runs
 * are a floor, not a race, so the estimate errs slow.
 */
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

/** Whether a date (YYYY-MM-DD or ISO) is inside the last 16 weeks, as best efforts count. */
function isInWindow(date: string, now: Date) {
  const oldest = new Date(now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000);
  return date.slice(0, 10) >= oldest.toISOString().slice(0, 10);
}

/**
 * A race result sets the paces for as long as best efforts count, then stops, since it no
 * longer says much about fitness now; it stays saved and shown until the athlete clears it.
 */
export function isRaceResultCurrent(raceResult: RaceResult, now: Date) {
  return isInWindow(raceResult.date, now);
}

export function roundVdot(vdot: number) {
  return Math.round(vdot * 10) / 10;
}

/** The race distances an athlete can pick a best effort at: the race result's distances. */
export const EFFORT_CHOICE_DISTANCES = RACE_DISTANCES;

/** One distance's best efforts to pick from: the best of the last 16 weeks, and of all time. */
export type EffortChoice = {
  metres: number;
  recent: RunEffort | null;
  allTime: RunEffort | null;
};

/** The fastest effort per race distance: in the window, and over every road run copied. */
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

/** The easy pace from zone 2 heart rate, or why there is none. */
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
  /** The athlete's choice, which may not be what sets the paces: an old race result stops. */
  from: PacesFrom;
  raceResult: RaceResult | null;
  /** The picked best effort, used as it is until the athlete changes it. */
  effort: RunEffort | null;
  /** A newer best at the picked effort's distance, once the pick is older than 16 weeks. */
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
        /** Where the easy pace came from: zone 2 when chosen and enough of it was found. */
        easySource: EasyFrom;
        /** Zone 2 was found but ran faster than marathon pace, so easy came from the VDOT. */
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

/**
 * The athlete's training paces from their choice: a picked best effort as it is, a race result
 * while current, else the estimate. The easy pace comes from zone 2 when chosen and found.
 */
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
  const effort = from === "effort" ? settings.effort : null;
  const race =
    from === "race" && raceResult && isRaceResultCurrent(raceResult, now) ? raceResult : null;
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
  // Easy is never faster than marathon pace: a zone 2 that fast means zones set too high or a
  // VDOT read too low, and the plan would prescribe easy running at race pace (ADR 0042).
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
