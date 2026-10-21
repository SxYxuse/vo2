import { allElevationClimbs, type ActivitySample } from "./activity-analysis.types.ts";
import { bandIndexForGrade, GRADE_BANDS } from "./grade-bands.ts";
import type { RideGradeBand } from "./ride-analysis.ts";
import type { RouteProfile, RouteStep } from "./route-gpx.ts";
import { sportGroupFor, type SportGroupId } from "./sport-groups.ts";

export const ROUTE_PREDICTION_VERSION = 2;

/** Sports a route can be planned for; swimming has no route to upload (ADR 0017). */
export type RouteSportGroup = Extract<SportGroupId, "cycling" | "running" | "walking">;

export function routeSportGroup(sportType: string): RouteSportGroup | null {
  const id = sportGroupFor(sportType)?.id;
  return id === "cycling" || id === "running" || id === "walking" ? id : null;
}

const DAY_MS = 86_400_000;
/** The speed curve reads this far back; similar activities read twice as far. */
const CURVE_DAYS = 182;
const SIMILAR_DAYS = 365;
const RECENCY_HALF_LIFE_DAYS = 60;
/** A grade band needs this much data before the athlete's own speed replaces the model. */
const BAND_TRUST_SEC = 10 * 60;
const MAX_SIMILAR = 5;
const SIMILAR_DISTANCE_SPREAD = 0.35;
const SIMILAR_CLIMB_SPREAD = 0.5;
/** Gain per km under this counts as flat, so 2 vs 4 m/km never reads as "twice as hilly". */
const FLAT_CLIMB_M_PER_KM = 3;
/** Each capped so form and fitness nudge the prediction, never drive it. */
const FORM_PCT_PER_TSB = 0.1;
const MAX_FORM_PCT = 3;
const FITNESS_SENSITIVITY = 0.1;
const MAX_FITNESS_PCT = 3;
const SESSION_FACTOR_RANGE = [0.85, 1.2] as const;
/** Past the athlete's longest similar session, speed drops this much per extra hour. */
const BEYOND_EXPERIENCE_PCT_PER_HOUR = 4;
const MAX_BEYOND_EXPERIENCE_PCT = 15;

type GroupDefaults = {
  flatKmh: number;
  stopFactor: number;
  maxDescentKmh: number;
  /** On foot, braking keeps descents near flat pace whatever the slope's energy cost says. */
  maxDescentOfFlat: number | null;
  minClimbKmh: number;
  splitKm: number;
};

const DEFAULTS: Record<RouteSportGroup, GroupDefaults> = {
  cycling: {
    flatKmh: 27,
    stopFactor: 1.06,
    maxDescentKmh: 50,
    maxDescentOfFlat: null,
    minClimbKmh: 5,
    splitKm: 5,
  },
  running: {
    flatKmh: 10,
    stopFactor: 1.02,
    maxDescentKmh: 16,
    maxDescentOfFlat: 1.2,
    minClimbKmh: 3,
    splitKm: 1,
  },
  walking: {
    flatKmh: 4.5,
    stopFactor: 1.1,
    maxDescentKmh: 6,
    maxDescentOfFlat: 1.1,
    minClimbKmh: 1.5,
    splitKm: 1,
  },
};

/** Grade (%) each band stands for when the model is calibrated against it. */
const BAND_GRADES = [-8, -4, 0, 4, 8, 14];

// Cycling: the flat speed's power against air, rolling resistance and gravity, with riders
// pushing harder uphill, up to CLIMB_POWER_BOOST more from 6 %.
const AIR_DENSITY = 1.2;
const CDA_M2 = 0.4;
const CLIMB_POWER_BOOST = 0.25;
const CRR = 0.005;
const BIKE_KG = 9;
const DEFAULT_BODY_KG = 75;
const G = 9.81;

function cyclingSpeed(flatMs: number, gradePct: number, massKg: number) {
  const air = 0.5 * AIR_DENSITY * CDA_M2;
  const boost = 1 + CLIMB_POWER_BOOST * clamp(gradePct / 6, 0, 1);
  const power = flatMs * (air * flatMs ** 2 + massKg * G * CRR) * boost;
  const theta = Math.atan(gradePct / 100);
  const resist = massKg * G * (CRR * Math.cos(theta) + Math.sin(theta));
  let low = 0.3;
  let high = 40;
  for (let index = 0; index < 50; index += 1) {
    const mid = (low + high) / 2;
    if (mid * (air * mid ** 2 + resist) > power) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/** Minetti et al. (2002): metabolic cost per metre on a slope, J/kg/m. */
function minettiCost(gradePct: number) {
  const i = Math.max(-0.45, Math.min(0.45, gradePct / 100));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

function footSpeed(flatMs: number, gradePct: number) {
  return flatMs * (minettiCost(0) / minettiCost(gradePct));
}

export type HistoryActivity = {
  id: string;
  name: string;
  sportType: string;
  startDate: string;
  movingSec: number;
  elapsedSec: number;
  distanceM: number;
  gainM: number;
  /** Moving time and speed per grade band, from the local copy of streams. */
  bands: RideGradeBand[];
  /** Fitness on the day of the activity. */
  ctl: number | null;
};

export type SimilarActivity = {
  id: string;
  name: string;
  startDate: string;
  distanceM: number;
  gainM: number;
  movingSec: number;
  score: number;
};

export type PredictedStep = RouteStep & {
  /** Elapsed time from the start, stops included. */
  atSec: number;
  speedKmh: number;
};

export type RouteClimb = {
  startSec: number;
  endSec: number;
  startKm: number;
  endKm: number;
  durationSec: number;
  gainM: number;
  avgGradePct: number | null;
};

export type RouteSplit = {
  fromKm: number;
  toKm: number;
  /** Elapsed, stops included. */
  durationSec: number;
  speedKmh: number;
  gainM: number;
};

export type PredictionConfidence = "high" | "medium" | "low";

export type RoutePrediction = {
  version: typeof ROUTE_PREDICTION_VERSION;
  sportType: string;
  sportGroup: RouteSportGroup;
  distanceM: number;
  gainM: number;
  lossM: number;
  hasElevation: boolean;
  movingSec: number;
  elapsedSec: number;
  steps: PredictedStep[];
  splits: RouteSplit[];
  climbs: RouteClimb[];
  basis: {
    similar: SimilarActivity[];
    /** Minutes of the athlete's own data per grade band, in GRADE_BANDS order. */
    bandMinutes: number[];
    flatKmh: number;
    sessionFactor: number;
    stopFactor: number;
    formPct: number;
    fitnessPct: number;
    beyondExperience: boolean;
    confidence: PredictionConfidence;
    warnings: string[];
  };
};

export type PredictionInput = {
  profile: RouteProfile;
  sportType: string;
  history: HistoryActivity[];
  now: Date;
  /** Current fitness and form. */
  form: { ctl: number | null; tsb: number | null };
  bodyWeightKg: number | null;
  /** Similar activities chosen by the coach model; defaults to the top-scored ones. */
  similar?: { id: string; weight: number }[] | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ageDays(startDate: string, now: Date) {
  return Math.max(0, (now.getTime() - new Date(startDate).getTime()) / DAY_MS);
}

function climbPerKm(gainM: number, distanceM: number) {
  return distanceM > 0 ? gainM / (distanceM / 1000) : 0;
}

/** Same sport group, last 12 months, comparable distance and climbing, best match first. */
export function rankSimilarActivities(
  profile: Pick<RouteProfile, "distanceM" | "gainM">,
  sportType: string,
  history: HistoryActivity[],
  now: Date,
): SimilarActivity[] {
  const group = routeSportGroup(sportType);
  const routeClimb = climbPerKm(profile.gainM, profile.distanceM);
  const climbTolerance = Math.max(routeClimb * SIMILAR_CLIMB_SPREAD, FLAT_CLIMB_M_PER_KM);
  return history
    .flatMap((activity): SimilarActivity[] => {
      if (routeSportGroup(activity.sportType) !== group) return [];
      const age = ageDays(activity.startDate, now);
      if (age > SIMILAR_DAYS || profile.distanceM <= 0) return [];
      const distanceGap = Math.abs(activity.distanceM / profile.distanceM - 1);
      const climbGap = Math.abs(climbPerKm(activity.gainM, activity.distanceM) - routeClimb);
      if (distanceGap > SIMILAR_DISTANCE_SPREAD || climbGap > climbTolerance) return [];
      const score =
        1 -
        0.4 * (distanceGap / SIMILAR_DISTANCE_SPREAD) -
        0.4 * (climbGap / climbTolerance) -
        0.2 * (age / SIMILAR_DAYS);
      return [
        {
          id: activity.id,
          name: activity.name,
          startDate: activity.startDate,
          distanceM: activity.distanceM,
          gainM: activity.gainM,
          movingSec: activity.movingSec,
          score: round(clamp(score, 0, 1), 2),
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
}

function bandIndexOf(band: RideGradeBand) {
  return GRADE_BANDS.findIndex((item) => item.min === band.minGrade);
}

type SpeedCurve = {
  flatMs: number;
  /** Observed ÷ modelled speed per band, blended toward 1 when data is thin. */
  calibration: number[];
  bandSec: number[];
  maxDescentMs: number;
  speedAt: (gradePct: number) => number;
};

function buildSpeedCurve(
  group: RouteSportGroup,
  history: HistoryActivity[],
  now: Date,
  massKg: number,
): SpeedCurve {
  const defaults = DEFAULTS[group];
  const model = (flatMs: number, gradePct: number) =>
    group === "cycling" ? cyclingSpeed(flatMs, gradePct, massKg) : footSpeed(flatMs, gradePct);

  const recent = history.filter(
    (activity) =>
      routeSportGroup(activity.sportType) === group &&
      ageDays(activity.startDate, now) <= CURVE_DAYS,
  );
  const bandSec = GRADE_BANDS.map(() => 0);
  const weighted = GRADE_BANDS.map(() => ({ speed: 0, weight: 0 }));
  for (const activity of recent) {
    const recency = 0.5 ** (ageDays(activity.startDate, now) / RECENCY_HALF_LIFE_DAYS);
    for (const band of activity.bands) {
      const index = bandIndexOf(band);
      const bucket = weighted[index];
      if (!bucket || band.avgSpeedKmh == null || band.avgSpeedKmh <= 0) continue;
      bandSec[index] = (bandSec[index] ?? 0) + band.durationSec;
      bucket.speed += (band.avgSpeedKmh / 3.6) * band.durationSec * recency;
      bucket.weight += band.durationSec * recency;
    }
  }
  const observed = weighted.map((bucket) =>
    bucket.weight > 0 ? bucket.speed / bucket.weight : null,
  );

  // Flat speed: the athlete's flat band if it has enough data, else what every band implies on
  // the flat through the model, else the sport default.
  const flatIndex = bandIndexForGrade(0);
  const flatEquivalents = observed.flatMap((speed, index) => {
    if (speed == null) return [];
    let low = 0.3;
    let high = 30;
    for (let step = 0; step < 40; step += 1) {
      const mid = (low + high) / 2;
      if (model(mid, BAND_GRADES[index] ?? 0) > speed) high = mid;
      else low = mid;
    }
    return [{ flat: (low + high) / 2, weight: bandSec[index] ?? 0 }];
  });
  const observedFlat = observed[flatIndex];
  const totalWeight = flatEquivalents.reduce((sum, item) => sum + item.weight, 0);
  const flatMs =
    observedFlat != null && (bandSec[flatIndex] ?? 0) >= BAND_TRUST_SEC
      ? observedFlat
      : totalWeight > 0
        ? flatEquivalents.reduce((sum, item) => sum + item.flat * item.weight, 0) / totalWeight
        : defaults.flatKmh / 3.6;

  const calibration = observed.map((speed, index) => {
    if (speed == null) return 1;
    const trust = Math.min(1, (bandSec[index] ?? 0) / BAND_TRUST_SEC);
    const ratio = speed / model(flatMs, BAND_GRADES[index] ?? 0);
    return 1 + (ratio - 1) * trust;
  });
  const descentSpeeds = observed.slice(0, 2).filter((speed): speed is number => speed != null);
  const maxDescentMs =
    descentSpeeds.length > 0
      ? Math.min(defaults.maxDescentKmh / 3.6, Math.max(...descentSpeeds) * 1.15)
      : Math.min(
          defaults.maxDescentKmh / 3.6,
          defaults.maxDescentOfFlat == null ? Infinity : flatMs * defaults.maxDescentOfFlat,
        );

  return {
    flatMs,
    calibration,
    bandSec,
    maxDescentMs,
    speedAt: (gradePct) => {
      const band = bandIndexForGrade(gradePct);
      const speed = model(flatMs, gradePct) * (calibration[band] ?? 1);
      return clamp(speed, defaults.minClimbKmh / 3.6, Math.max(flatMs, maxDescentMs));
    },
  };
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** How the similar sessions' moving time compared to what the curve alone gives for them. */
function sessionFactorFor(
  chosen: { activity: HistoryActivity; weight: number }[],
  curve: SpeedCurve,
) {
  let sum = 0;
  let weight = 0;
  for (const { activity, weight: w } of chosen) {
    let predicted = 0;
    let actual = 0;
    for (const band of activity.bands) {
      const index = bandIndexOf(band);
      if (index < 0 || band.avgSpeedKmh == null) continue;
      const distance = band.distanceM ?? (band.avgSpeedKmh / 3.6) * band.durationSec;
      predicted += distance / curve.speedAt(BAND_GRADES[index] ?? 0);
      actual += band.durationSec;
    }
    if (predicted <= 0 || actual <= 0) continue;
    sum += (actual / predicted) * w;
    weight += w;
  }
  return weight > 0 ? clamp(sum / weight, ...SESSION_FACTOR_RANGE) : 1;
}

function splitsFor(steps: PredictedStep[], splitKm: number, endSec: number): RouteSplit[] {
  const splits: RouteSplit[] = [];
  const splitM = splitKm * 1000;
  let index = 0;
  while (index < steps.length) {
    const first = steps[index];
    if (!first) break;
    const from = Math.floor(first.distanceM / splitM) * splitM;
    let last = index;
    let gain = 0;
    let movingSec = first.lengthM / (first.speedKmh / 3.6);
    while (last + 1 < steps.length && (steps[last + 1]?.distanceM ?? 0) < from + splitM) {
      const delta = (steps[last + 1]?.altitudeM ?? 0) - (steps[last]?.altitudeM ?? 0);
      if (delta > 0) gain += delta;
      last += 1;
      const step = steps[last] as PredictedStep;
      movingSec += step.lengthM / (step.speedKmh / 3.6);
    }
    const lastStep = steps[last] as PredictedStep;
    const end = steps[last + 1]?.atSec ?? endSec;
    const toM = lastStep.distanceM + lastStep.lengthM;
    const durationSec = end - first.atSec;
    splits.push({
      fromKm: round(from / 1000, 1),
      toKm: round(toM / 1000, 1),
      durationSec: round(durationSec),
      // Moving speed: stops are spread over the whole route, not ridden.
      speedKmh: movingSec > 0 ? round(((toM - first.distanceM) / movingSec) * 3.6, 1) : 0,
      gainM: round(gain),
    });
    index = last + 1;
  }
  return splits;
}

function routeClimbs(steps: PredictedStep[], sportType: string): RouteClimb[] {
  const samples: ActivitySample[] = steps.map((step) => ({
    t: step.atSec,
    distanceM: step.distanceM,
    altitudeM: step.altitudeM,
    gradePct: step.gradePct,
    heartrate: null,
    watts: null,
    speedKmh: step.speedKmh,
    cadence: null,
  }));
  const kmAt = new Map(steps.map((step) => [step.atSec, step.distanceM / 1000]));
  return allElevationClimbs(samples, sportType).map((climb) => {
    const startKm = kmAt.get(climb.startSec) ?? 0;
    return {
      startSec: round(climb.startSec),
      endSec: round(climb.endSec),
      startKm: round(startKm, 1),
      endKm: round(startKm + (climb.distanceM ?? 0) / 1000, 1),
      durationSec: round(climb.durationSec),
      gainM: round(climb.elevationDeltaM),
      avgGradePct: climb.avgGradePct,
    };
  });
}

/** Predicts when the athlete reaches each point of the route, from their own history. */
export function predictRoute(input: PredictionInput): RoutePrediction {
  const { profile, sportType, history, now } = input;
  const group = routeSportGroup(sportType);
  if (!group) throw new Error(`${sportType} routes are not planned.`);
  const defaults = DEFAULTS[group];
  const warnings: string[] = [];
  if (!profile.hasElevation)
    warnings.push("The GPX file has no elevation, so the route is treated as flat.");

  const massKg = (input.bodyWeightKg ?? DEFAULT_BODY_KG) + (group === "cycling" ? BIKE_KG : 0);
  const curve = buildSpeedCurve(group, history, now, massKg);
  const curveMinutes = curve.bandSec.reduce((sum, sec) => sum + sec, 0) / 60;
  if (curveMinutes === 0)
    warnings.push("No recent activities in this sport: speeds are typical, not yours.");

  const ranked = rankSimilarActivities(profile, sportType, history, now);
  const byId = new Map(history.map((activity) => [activity.id, activity]));
  const picked = (
    input.similar ??
    ranked.slice(0, MAX_SIMILAR).map((item) => ({ id: item.id, weight: item.score }))
  ).flatMap(({ id, weight }) => {
    const activity = byId.get(id);
    return activity && weight > 0 ? [{ activity, weight }] : [];
  });
  if (picked.length === 0)
    warnings.push(
      "No comparable past activity: the prediction leans on your speed by gradient only.",
    );

  const sessionFactor = sessionFactorFor(picked, curve);
  const stopFactor = clamp(
    median(
      picked.flatMap(({ activity }) =>
        activity.movingSec > 0 ? [activity.elapsedSec / activity.movingSec] : [],
      ),
    ) ?? defaults.stopFactor,
    1,
    1.5,
  );
  const formPct =
    input.form.tsb == null
      ? 0
      : clamp(input.form.tsb * FORM_PCT_PER_TSB, -MAX_FORM_PCT, MAX_FORM_PCT);
  const similarCtl = picked.flatMap(({ activity }) =>
    activity.ctl != null && activity.ctl > 0 ? [activity.ctl] : [],
  );
  const pastCtl = similarCtl.length
    ? similarCtl.reduce((a, b) => a + b, 0) / similarCtl.length
    : null;
  const fitnessPct =
    input.form.ctl != null && pastCtl != null
      ? clamp(
          (input.form.ctl / pastCtl - 1) * 100 * FITNESS_SENSITIVITY,
          -MAX_FITNESS_PCT,
          MAX_FITNESS_PCT,
        )
      : 0;
  const longestSec = Math.max(
    0,
    ...(picked.length
      ? picked.map(({ activity }) => activity.movingSec)
      : history
          .filter((activity) => routeSportGroup(activity.sportType) === group)
          .map((a) => a.movingSec)),
  );

  const scale = ((1 + formPct / 100) * (1 + fitnessPct / 100)) / sessionFactor;
  let movingSec = 0;
  let beyondExperience = false;
  const steps: PredictedStep[] = profile.steps.map((step) => {
    let speed = curve.speedAt(step.gradePct) * scale;
    if (longestSec > 0 && movingSec > longestSec) {
      beyondExperience = true;
      const extraHours = (movingSec - longestSec) / 3600;
      speed *=
        1 - Math.min(MAX_BEYOND_EXPERIENCE_PCT, extraHours * BEYOND_EXPERIENCE_PCT_PER_HOUR) / 100;
    }
    const atSec = movingSec * stopFactor;
    movingSec += step.lengthM / speed;
    return { ...step, atSec: round(atSec), speedKmh: round(speed * 3.6, 1) };
  });
  if (beyondExperience)
    warnings.push(
      picked.length > 0
        ? "This route is longer than anything comparable you have done, so the end is predicted slower."
        : "This route is longer than any of your past activities in this sport, so the end is predicted slower.",
    );
  const elapsedSec = movingSec * stopFactor;

  const confidence: PredictionConfidence =
    picked.length >= 3 && curveMinutes >= 120
      ? "high"
      : picked.length > 0 || curveMinutes >= 60
        ? "medium"
        : "low";

  return {
    version: ROUTE_PREDICTION_VERSION,
    sportType,
    sportGroup: group,
    distanceM: profile.distanceM,
    gainM: profile.gainM,
    lossM: profile.lossM,
    hasElevation: profile.hasElevation,
    movingSec: round(movingSec),
    elapsedSec: round(elapsedSec),
    steps,
    splits: splitsFor(steps, defaults.splitKm, elapsedSec),
    climbs: routeClimbs(steps, sportType),
    basis: {
      similar: ranked.filter((item) => picked.some(({ activity }) => activity.id === item.id)),
      bandMinutes: curve.bandSec.map((sec) => round(sec / 60)),
      flatKmh: round(curve.flatMs * 3.6, 1),
      sessionFactor: round(sessionFactor, 3),
      stopFactor: round(stopFactor, 3),
      formPct: round(formPct, 1),
      fitnessPct: round(fitnessPct, 1),
      beyondExperience,
      confidence,
      warnings,
    },
  };
}
