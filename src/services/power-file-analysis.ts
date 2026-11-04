import { powerBests, type PowerBest } from "./best-efforts.ts";
import { RIDE_ZONES, type RideZone } from "./coach-plan.types.ts";
import { computeDecoupling, efficiencyFactor, type DecouplingResult } from "./heart-insights.ts";
import { heartRateFamily, isPlausibleBpm } from "./heart-rate.ts";
import { normalizedPowerFromWatts } from "./normalized-power.ts";
import {
  buildRideAnalysis,
  summarizeRide,
  type RideAnalysis,
  type RideSummary,
} from "./ride-analysis.ts";

/*
 * A power file is a ride's FIT file imported from the athlete's head unit (ADR 0056). It carries
 * what Strava's streams drop: each pedal's share of power, where on the pedal the force goes, the
 * arc of each stroke, seated and standing, and the gears. The analysis is stored without FTP or
 * weight, so zones and quadrants follow the athlete's current FTP when the page is read.
 */

/** Bump when the stored shape or the math changes; the stored file is analysed again on view. */
export const POWER_FILE_ANALYSIS_VERSION = 1;

/** Longest gap one sample may stand for. Records stop while the timer is paused. */
const MAX_SAMPLE_SEC = 10;
const POWER_BIN_W = 10;
const CADENCE_BIN_RPM = 5;
const FORCE_CADENCE_BIN_RPM = 2;
const FORCE_TORQUE_BIN_NM = 2;
/** Below this cadence torque is a standing start or a sensor glitch, not pedaling. */
const MIN_TORQUE_CADENCE = 20;
const MAX_TORQUE_NM = 250;
const SERIES_POINTS = 600;
const PCO_MIN_MM = -20;
const PCO_MAX_MM = 30;
const CURVE_DURATIONS = [
  1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600,
  5400, 7200, 10800, 14400, 18000,
];
/** A share of FTP at or below which each ride zone ends (`cycling/zones.md`). */
const ZONE_CEILINGS: Record<RideZone, number> = {
  recovery: 0.55,
  endurance: 0.75,
  tempo: 0.87,
  sweetSpot: 0.94,
  threshold: 1.05,
  vo2max: 1.2,
  anaerobic: 1.5,
  sprint: Infinity,
};

export type FitAngles = [start: number, end: number];

/** One record of the file, read into plain numbers by `power-file-fit.server.ts`. */
export type FitSample = {
  /** Seconds since the ride started. */
  t: number;
  watts: number | null;
  heartrate: number | null;
  cadence: number | null;
  /** m/s */
  speed: number | null;
  distance: number | null;
  altitude: number | null;
  /** The right pedal's share of power, %; the left pedal has the rest. */
  rightPct: number | null;
  /** Platform center offset, mm: positive is toward the outside of the pedal. */
  pcoLeft: number | null;
  pcoRight: number | null;
  /** Crank angles where the pedal makes positive power, degrees from top dead center. */
  phaseLeft: FitAngles | null;
  phaseRight: FitAngles | null;
  /** Crank angles where the pedal makes its peak power. */
  peakLeft: FitAngles | null;
  peakRight: FitAngles | null;
  teLeft: number | null;
  teRight: number | null;
  psLeft: number | null;
  psRight: number | null;
  /** Null when the file has no rider positions. */
  standing: boolean | null;
  /** Chainring and cog teeth, from electronic shifting. */
  gear: [front: number, rear: number] | null;
};

export type PowerFileLap = {
  /** Seconds since the ride started. */
  startSec: number;
  movingSec: number;
  distanceM: number | null;
  avgWatts: number | null;
  normalizedWatts: number | null;
  maxWatts: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgCadence: number | null;
  avgSpeedKmh: number | null;
  ascentM: number | null;
  rightPct: number | null;
  pcoLeft: number | null;
  pcoRight: number | null;
  arcLeft: number | null;
  arcRight: number | null;
  standingSec: number | null;
};

export type PowerMeterInfo = {
  maker: string;
  firmware: string | null;
  battery: string | null;
};

export type FitRide = {
  start: Date;
  /** Strava's name for the kind of ride, so VO2's ride rules apply. */
  sportType: string;
  elapsedSec: number;
  timerSec: number | null;
  distanceM: number | null;
  ascentM: number | null;
  calories: number | null;
  temperature: { avg: number | null; min: number | null; max: number | null } | null;
  trainingEffect: { aerobic: number | null; anaerobic: number | null } | null;
  respiration: { avg: number | null; min: number | null; max: number | null } | null;
  ftp: number | null;
  weightKg: number | null;
  device: string | null;
  powerMeter: PowerMeterInfo | null;
  shifts: { front: number; rear: number } | null;
  laps: PowerFileLap[];
  samples: FitSample[];
};

/** Weight, Σ w·sin and Σ w·cos of start and end, and Σ w·arc: angles average around the circle. */
type AngleSums = [
  weight: number,
  startSin: number,
  startCos: number,
  endSin: number,
  endCos: number,
  arc: number,
];
type MeanSums = [count: number, sum: number];
type SideSums = { pco: MeanSums; phase: AngleSums; peak: AngleSums; te: MeanSums; ps: MeanSums };

/** Sums that merge by adding, so power bins can be pooled into any FTP's zones later. */
export type PedalSums = {
  sec: number;
  /** Σ watts·s */
  work: number;
  pedalSec: number;
  /** Σ rpm·s while pedaling */
  cadence: number;
  /** Σ watts·s where balance is known, and Σ watts·s·right %. */
  balance: MeanSums;
  left: SideSums;
  right: SideSums;
};

export type PowerFileSeries = {
  bucketSec: number;
  /** Moving seconds at the start of each bucket. */
  t: number[];
  watts: (number | null)[];
  heartrate: (number | null)[];
  cadence: (number | null)[];
  speedKmh: (number | null)[];
  altitude: (number | null)[];
  rightPct: (number | null)[];
  pcoLeft: (number | null)[];
  pcoRight: (number | null)[];
  standingPct: (number | null)[];
};

export type GearUse = {
  front: number;
  rear: number;
  sec: number;
  avgWatts: number | null;
  avgCadence: number | null;
  avgSpeedKmh: number | null;
};

export type PowerFileAnalysis = {
  version: typeof POWER_FILE_ANALYSIS_VERSION;
  start: string;
  sportType: string;
  elapsedSec: number;
  movingSec: number;
  distanceM: number | null;
  ascentM: number | null;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  calories: number | null;
  temperature: FitRide["temperature"];
  trainingEffect: FitRide["trainingEffect"];
  respiration: FitRide["respiration"];
  fileFtp: number | null;
  fileWeightKg: number | null;
  device: string | null;
  powerMeter: PowerMeterInfo | null;
  power: {
    avg: number;
    max: number;
    normalized: number | null;
    workKj: number;
    curve: PowerBest[];
  };
  heart: { avg: number; max: number; decoupling: DecouplingResult } | null;
  cadence: {
    avg: number | null;
    max: number | null;
    coastingSec: number;
    /** [rpm bin start, seconds] while pedaling. */
    histogram: [number, number][];
  } | null;
  torque: { avg: number; max: number } | null;
  /** [rpm bin start, Nm bin start, seconds] while pedaling, for quadrant analysis. */
  forceCells: [number, number, number][];
  /** [watts bin start, sums]: zones and pedaling by zone are pooled from these. */
  powerBins: [number, PedalSums][];
  seated: PedalSums | null;
  standing: PedalSums | null;
  standCount: number | null;
  /** [mm, left seconds, right seconds] */
  pcoHistogram: [number, number, number][];
  laps: PowerFileLap[];
  gears: {
    frontShifts: number | null;
    rearShifts: number | null;
    chainrings: number[];
    cogs: number[];
    crossChainSec: number | null;
    uses: GearUse[];
  } | null;
  terrain: RideAnalysis;
  series: PowerFileSeries;
  quality: {
    samples: number;
    missingPowerSec: number;
    /** Share of pedaling time with balance, and with pedal stroke data. Null on a one-sided meter. */
    balancePct: number | null;
    dynamicsPct: number | null;
  };
};

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean([count, sum]: MeanSums, digits = 0) {
  return count > 0 ? round(sum / count, digits) : null;
}

function emptyAngles(): AngleSums {
  return [0, 0, 0, 0, 0, 0];
}

function emptySide(): SideSums {
  return { pco: [0, 0], phase: emptyAngles(), peak: emptyAngles(), te: [0, 0], ps: [0, 0] };
}

export function emptyPedalSums(): PedalSums {
  return {
    sec: 0,
    work: 0,
    pedalSec: 0,
    cadence: 0,
    balance: [0, 0],
    left: emptySide(),
    right: emptySide(),
  };
}

const RAD = Math.PI / 180;

/** Degrees from start to end going forward around the crank. */
function arcLength(start: number, end: number) {
  return (((end - start) % 360) + 360) % 360;
}

function addMean(target: MeanSums, value: number | null, weight: number) {
  if (value == null || !Number.isFinite(value)) return;
  target[0] += weight;
  target[1] += value * weight;
}

function addAngles(target: AngleSums, angles: FitAngles | null, weight: number) {
  if (!angles || weight <= 0) return;
  const [start, end] = angles;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  target[0] += weight;
  target[1] += weight * Math.sin(start * RAD);
  target[2] += weight * Math.cos(start * RAD);
  target[3] += weight * Math.sin(end * RAD);
  target[4] += weight * Math.cos(end * RAD);
  target[5] += weight * arcLength(start, end);
}

function addSample(sums: PedalSums, sample: FitSample, dt: number) {
  const watts = sample.watts ?? 0;
  // Balance and the stroke angles are weighed by power: a soft pedal stroke says little.
  const weight = watts * dt;
  sums.sec += dt;
  sums.work += weight;
  if (sample.cadence != null && sample.cadence > 0) {
    sums.pedalSec += dt;
    sums.cadence += sample.cadence * dt;
  }
  if (weight > 0) addMean(sums.balance, sample.rightPct, weight);
  const sides = [
    [sums.left, sample.pcoLeft, sample.phaseLeft, sample.peakLeft, sample.teLeft, sample.psLeft],
    [
      sums.right,
      sample.pcoRight,
      sample.phaseRight,
      sample.peakRight,
      sample.teRight,
      sample.psRight,
    ],
  ] as const;
  for (const [side, pco, phase, peak, te, ps] of sides) {
    if (weight <= 0) continue;
    addMean(side.pco, pco, dt);
    addAngles(side.phase, phase, weight);
    addAngles(side.peak, peak, weight);
    addMean(side.te, te, dt);
    addMean(side.ps, ps, dt);
  }
}

function addNumbers<T extends number[]>(target: T, source: T) {
  for (let index = 0; index < target.length; index += 1) target[index] += source[index];
}

function addSide(target: SideSums, source: SideSums) {
  addNumbers(target.pco, source.pco);
  addNumbers(target.phase, source.phase);
  addNumbers(target.peak, source.peak);
  addNumbers(target.te, source.te);
  addNumbers(target.ps, source.ps);
}

export function mergePedalSums(target: PedalSums, source: PedalSums) {
  target.sec += source.sec;
  target.work += source.work;
  target.pedalSec += source.pedalSec;
  target.cadence += source.cadence;
  addNumbers(target.balance, source.balance);
  addSide(target.left, source.left);
  addSide(target.right, source.right);
}

/** Rounds the stored sums: the analysis is kept as JSON and read on every view. */
function compactSums(sums: PedalSums): PedalSums {
  const compact = <T extends number[]>(values: T) => values.map((value) => round(value, 1)) as T;
  const side = (value: SideSums): SideSums => ({
    pco: compact(value.pco),
    phase: compact(value.phase),
    peak: compact(value.peak),
    te: compact(value.te),
    ps: compact(value.ps),
  });
  return {
    sec: round(sums.sec, 1),
    work: round(sums.work),
    pedalSec: round(sums.pedalSec, 1),
    cadence: round(sums.cadence),
    balance: compact(sums.balance),
    left: side(sums.left),
    right: side(sums.right),
  };
}

/** How long each sample stands for: a long gap is a pause, so the sample counts once. */
function sampleSeconds(samples: FitSample[], index: number) {
  const next = samples[index + 1];
  if (!next) return 1;
  const gap = next.t - samples[index].t;
  if (!(gap > 0)) return 0;
  return gap <= MAX_SAMPLE_SEC ? gap : 1;
}

class Mean {
  sum = 0;
  weight = 0;
  add(value: number | null, weight: number) {
    if (value == null || !Number.isFinite(value) || weight <= 0) return;
    this.sum += value * weight;
    this.weight += weight;
  }
  value(digits = 0) {
    return this.weight > 0 ? round(this.sum / this.weight, digits) : null;
  }
}

function seriesBuckets(samples: FitSample[], movingSec: number): PowerFileSeries {
  const bucketSec = Math.max(1, Math.ceil(movingSec / SERIES_POINTS));
  type Bucket = Record<Exclude<keyof PowerFileSeries, "bucketSec" | "t">, Mean>;
  const buckets: Bucket[] = [];
  const emptyBucket = (): Bucket => ({
    watts: new Mean(),
    heartrate: new Mean(),
    cadence: new Mean(),
    speedKmh: new Mean(),
    altitude: new Mean(),
    rightPct: new Mean(),
    pcoLeft: new Mean(),
    pcoRight: new Mean(),
    standingPct: new Mean(),
  });
  let clock = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const dt = sampleSeconds(samples, index);
    if (dt <= 0) continue;
    const at = Math.floor(clock / bucketSec);
    clock += dt;
    const bucket = (buckets[at] ??= emptyBucket());
    const watts = sample.watts ?? 0;
    bucket.watts.add(watts, dt);
    if (isPlausibleBpm(sample.heartrate)) bucket.heartrate.add(sample.heartrate, dt);
    if (sample.cadence != null && sample.cadence > 0) bucket.cadence.add(sample.cadence, dt);
    bucket.speedKmh.add(sample.speed == null ? null : sample.speed * 3.6, dt);
    bucket.altitude.add(sample.altitude, dt);
    if (watts > 0) {
      bucket.rightPct.add(sample.rightPct, watts * dt);
      bucket.pcoLeft.add(sample.pcoLeft, dt);
      bucket.pcoRight.add(sample.pcoRight, dt);
    }
    if (sample.standing != null) bucket.standingPct.add(sample.standing ? 100 : 0, dt);
  }
  const filled = Array.from(buckets, (bucket) => bucket ?? emptyBucket());
  const column = (key: keyof Bucket, digits = 0) =>
    filled.map((bucket) => bucket[key].value(digits));
  return {
    bucketSec,
    t: filled.map((_, index) => index * bucketSec),
    watts: column("watts"),
    heartrate: column("heartrate"),
    cadence: column("cadence"),
    speedKmh: column("speedKmh", 1),
    altitude: column("altitude"),
    rightPct: column("rightPct", 1),
    pcoLeft: column("pcoLeft", 1),
    pcoRight: column("pcoRight", 1),
    standingPct: column("standingPct"),
  };
}

function gearUses(samples: FitSample[], ride: FitRide): PowerFileAnalysis["gears"] {
  type Use = { front: number; rear: number; sec: number; watts: Mean; cadence: Mean; speed: Mean };
  const uses = new Map<string, Use>();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const dt = sampleSeconds(samples, index);
    if (!sample.gear || dt <= 0) continue;
    const [front, rear] = sample.gear;
    const key = `${front}x${rear}`;
    let use = uses.get(key);
    if (!use) {
      use = { front, rear, sec: 0, watts: new Mean(), cadence: new Mean(), speed: new Mean() };
      uses.set(key, use);
    }
    use.sec += dt;
    use.watts.add(sample.watts ?? 0, dt);
    if (sample.cadence != null && sample.cadence > 0) use.cadence.add(sample.cadence, dt);
    use.speed.add(sample.speed == null ? null : sample.speed * 3.6, dt);
  }
  if (!uses.size) return null;
  const list = [...uses.values()];
  const chainrings = [...new Set(list.map((use) => use.front))].sort((a, b) => a - b);
  const cogs = [...new Set(list.map((use) => use.rear))].sort((a, b) => a - b);
  // Cross-chaining: the big ring on the two biggest cogs, or the small ring on the two smallest.
  let crossChainSec: number | null = null;
  if (chainrings.length >= 2 && cogs.length >= 4) {
    const small = chainrings[0];
    const big = chainrings.at(-1);
    crossChainSec = round(
      list
        .filter(
          (use) =>
            (use.front === big && cogs.slice(-2).includes(use.rear)) ||
            (use.front === small && cogs.slice(0, 2).includes(use.rear)),
        )
        .reduce((sum, use) => sum + use.sec, 0),
    );
  }
  return {
    frontShifts: ride.shifts?.front ?? null,
    rearShifts: ride.shifts?.rear ?? null,
    chainrings,
    cogs,
    crossChainSec,
    uses: list
      .sort((a, b) => b.front / b.rear - a.front / a.rear)
      .map((use) => ({
        front: use.front,
        rear: use.rear,
        sec: round(use.sec),
        avgWatts: use.watts.value(),
        avgCadence: use.cadence.value(),
        avgSpeedKmh: use.speed.value(1),
      })),
  };
}

/** Everything about the ride that does not depend on the athlete's FTP or weight. */
export function buildPowerFileAnalysis(ride: FitRide): PowerFileAnalysis {
  const samples = ride.samples;
  const bins = new Map<number, PedalSums>();
  const hasPositions = samples.some((sample) => sample.standing != null);
  const seated = emptyPedalSums();
  const standing = emptyPedalSums();
  const heartrate = new Mean();
  const cadence = new Mean();
  const torque = new Mean();
  const speed = new Mean();
  const forceCells = new Map<string, [number, number, number]>();
  const cadenceBins = new Map<number, number>();
  const pco = new Map<number, [number, number, number]>();
  let movingSec = 0;
  let maxWatts = 0;
  let maxHeartrate = 0;
  let maxCadence = 0;
  let maxTorque = 0;
  let maxSpeed = 0;
  let coastingSec = 0;
  let missingPowerSec = 0;
  let pedalingSec = 0;
  let balanceSec = 0;
  let dynamicsSec = 0;
  let standCount = 0;
  let wasStanding = false;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const dt = sampleSeconds(samples, index);
    if (dt <= 0) continue;
    movingSec += dt;
    const watts = sample.watts ?? 0;
    if (sample.watts == null) missingPowerSec += dt;
    if (watts <= 2500) maxWatts = Math.max(maxWatts, watts);

    const bin = Math.floor(watts / POWER_BIN_W) * POWER_BIN_W;
    let sums = bins.get(bin);
    if (!sums) bins.set(bin, (sums = emptyPedalSums()));
    addSample(sums, sample, dt);
    if (hasPositions && sample.standing != null) {
      addSample(sample.standing ? standing : seated, sample, dt);
      if (sample.standing && !wasStanding) standCount += 1;
      wasStanding = sample.standing;
    }

    if (isPlausibleBpm(sample.heartrate)) {
      heartrate.add(sample.heartrate, dt);
      maxHeartrate = Math.max(maxHeartrate, sample.heartrate!);
    }
    if (sample.speed != null) {
      speed.add(sample.speed * 3.6, dt);
      maxSpeed = Math.max(maxSpeed, sample.speed * 3.6);
    }
    const rpm = sample.cadence ?? 0;
    if (sample.cadence === 0) coastingSec += dt;
    if (rpm > 0) {
      cadence.add(rpm, dt);
      maxCadence = Math.max(maxCadence, rpm);
      const cadenceBin = Math.floor(rpm / CADENCE_BIN_RPM) * CADENCE_BIN_RPM;
      cadenceBins.set(cadenceBin, (cadenceBins.get(cadenceBin) ?? 0) + dt);
    }
    if (rpm >= MIN_TORQUE_CADENCE && watts > 0) {
      const nm = watts / ((rpm * 2 * Math.PI) / 60);
      if (nm <= MAX_TORQUE_NM) {
        torque.add(nm, dt);
        maxTorque = Math.max(maxTorque, nm);
        const cell = [
          Math.floor(rpm / FORCE_CADENCE_BIN_RPM) * FORCE_CADENCE_BIN_RPM,
          Math.floor(nm / FORCE_TORQUE_BIN_NM) * FORCE_TORQUE_BIN_NM,
        ] as const;
        const key = `${cell[0]}:${cell[1]}`;
        const entry = forceCells.get(key) ?? [cell[0], cell[1], 0];
        entry[2] += dt;
        forceCells.set(key, entry);
      }
    }
    if (rpm > 0 && watts > 0) {
      pedalingSec += dt;
      if (sample.rightPct != null) balanceSec += dt;
      if (sample.phaseLeft || sample.phaseRight) dynamicsSec += dt;
      for (const [side, value] of [
        [1, sample.pcoLeft],
        [2, sample.pcoRight],
      ] as const) {
        if (value == null) continue;
        const mm = Math.min(PCO_MAX_MM, Math.max(PCO_MIN_MM, Math.round(value)));
        const entry = pco.get(mm) ?? [mm, 0, 0];
        entry[side] += dt;
        pco.set(mm, entry);
      }
    }
  }

  const time = samples.map((sample) => sample.t);
  const wattsStream = samples.map((sample) => sample.watts ?? 0);
  const nan = (value: number | null) => value ?? Number.NaN;
  const heartStream = samples.map((sample) => nan(sample.heartrate));
  const speedStream = samples.map((sample) => nan(sample.speed));
  const normalized = normalizedPowerFromWatts(wattsStream, time);
  const totalWork = [...bins.values()].reduce((sum, bin) => sum + bin.work, 0);
  const avgHeartrate = heartrate.value();

  return {
    version: POWER_FILE_ANALYSIS_VERSION,
    start: ride.start.toISOString(),
    sportType: ride.sportType,
    elapsedSec: Math.round(ride.elapsedSec),
    movingSec: round(movingSec),
    distanceM: ride.distanceM,
    ascentM: ride.ascentM,
    avgSpeedKmh: speed.value(1),
    maxSpeedKmh: speed.weight > 0 ? round(maxSpeed, 1) : null,
    calories: ride.calories,
    temperature: ride.temperature,
    trainingEffect: ride.trainingEffect,
    respiration: ride.respiration,
    fileFtp: ride.ftp,
    fileWeightKg: ride.weightKg,
    device: ride.device,
    powerMeter: ride.powerMeter,
    power: {
      avg: movingSec > 0 ? round(totalWork / movingSec) : 0,
      max: maxWatts,
      normalized: normalized == null ? null : round(normalized),
      workKj: round(totalWork / 1000),
      curve: powerBests(wattsStream, time, CURVE_DURATIONS),
    },
    heart:
      avgHeartrate == null
        ? null
        : {
            avg: avgHeartrate,
            max: maxHeartrate,
            decoupling: computeDecoupling(
              {
                time,
                heartrate: heartStream,
                watts: wattsStream,
                velocitySmooth: speedStream,
                moving: null,
                temp: null,
              },
              {
                family: heartRateFamily(ride.sportType),
                sportType: ride.sportType,
                distance: ride.distanceM,
                totalElevationGain: ride.ascentM,
              },
            ),
          },
    cadence:
      cadence.weight > 0
        ? {
            avg: cadence.value(),
            max: maxCadence,
            coastingSec: round(coastingSec),
            histogram: [...cadenceBins]
              .sort((a, b) => a[0] - b[0])
              .map(([rpm, sec]) => [rpm, round(sec)]),
          }
        : null,
    torque: torque.weight > 0 ? { avg: torque.value(1)!, max: round(maxTorque) } : null,
    forceCells: [...forceCells.values()].map(([rpm, nm, sec]) => [rpm, nm, round(sec, 1)]),
    powerBins: [...bins]
      .sort((a, b) => a[0] - b[0])
      .map(([watts, sums]) => [watts, compactSums(sums)]),
    seated: hasPositions ? compactSums(seated) : null,
    standing: hasPositions ? compactSums(standing) : null,
    standCount: hasPositions ? standCount : null,
    pcoHistogram: [...pco.values()]
      .sort((a, b) => a[0] - b[0])
      .map(([mm, left, right]) => [mm, round(left), round(right)]),
    laps: ride.laps,
    gears: gearUses(samples, ride),
    terrain: buildRideAnalysis({
      time,
      distance: samples.map((sample) => nan(sample.distance)),
      altitude: samples.map((sample) => nan(sample.altitude)),
      gradeSmooth: null,
      watts: wattsStream,
      cadence: samples.map((sample) => nan(sample.cadence)),
      velocitySmooth: speedStream,
      heartrate: heartStream,
      moving: null,
    }),
    series: seriesBuckets(samples, movingSec),
    quality: {
      samples: samples.length,
      missingPowerSec: round(missingPowerSec),
      balancePct:
        balanceSec > 0 && pedalingSec > 0 ? round((balanceSec / pedalingSec) * 100) : null,
      dynamicsPct:
        dynamicsSec > 0 && pedalingSec > 0 ? round((dynamicsSec / pedalingSec) * 100) : null,
    },
  };
}

export function isPowerFileAnalysis(value: unknown): value is PowerFileAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as PowerFileAnalysis;
  return analysis.version === POWER_FILE_ANALYSIS_VERSION && Array.isArray(analysis.powerBins);
}

// ---------------------------------------------------------------------------------------------
// Read time: the athlete's FTP and weight turn the sums into zones, quadrants, and W/kg.

export type StrokeAngles = { start: number; end: number; arc: number };

export type SidePedaling = {
  pco: number | null;
  phase: StrokeAngles | null;
  peak: StrokeAngles | null;
  torqueEffectiveness: number | null;
  pedalSmoothness: number | null;
};

export type Pedaling = {
  sec: number;
  avgWatts: number | null;
  avgCadence: number | null;
  rightPct: number | null;
  left: SidePedaling;
  right: SidePedaling;
};

export type PowerZoneRow = Pedaling & {
  id: RideZone;
  label: string;
  minWatts: number;
  maxWatts: number | null;
  pct: number;
};

export type Quadrants = {
  /** The ride's pedaling cadence, and the torque that makes FTP at that cadence. */
  cadence: number;
  torque: number;
  /** % of pedaling time: I high force and fast, II high force and slow, III low and slow, IV low force and fast. */
  pct: [number, number, number, number];
};

export type Anchor = { value: number; source: "vo2" | "file" };

export type PowerFileView = Omit<
  PowerFileAnalysis,
  "version" | "powerBins" | "seated" | "standing" | "forceCells" | "terrain" | "power"
> & {
  ftp: Anchor | null;
  weightKg: Anchor | null;
  power: PowerFileAnalysis["power"] & {
    intensityFactor: number | null;
    tss: number | null;
    variabilityIndex: number | null;
    efficiencyFactor: number | null;
  };
  zones: PowerZoneRow[];
  pedaling: {
    overall: Pedaling;
    seated: Pedaling | null;
    standing: Pedaling | null;
  };
  forceCells: [number, number, number][];
  quadrants: Quadrants | null;
  terrain: RideSummary | null;
};

function circularMean(sin: number, cos: number) {
  return round((((Math.atan2(sin, cos) / RAD) % 360) + 360) % 360);
}

function strokeAngles(sums: AngleSums): StrokeAngles | null {
  const [weight, startSin, startCos, endSin, endCos, arc] = sums;
  if (weight <= 0) return null;
  return {
    start: circularMean(startSin, startCos),
    end: circularMean(endSin, endCos),
    arc: round(arc / weight),
  };
}

function sidePedaling(side: SideSums): SidePedaling {
  return {
    pco: mean(side.pco, 1),
    phase: strokeAngles(side.phase),
    peak: strokeAngles(side.peak),
    torqueEffectiveness: mean(side.te),
    pedalSmoothness: mean(side.ps),
  };
}

export function pedalingFrom(sums: PedalSums): Pedaling {
  return {
    sec: round(sums.sec),
    avgWatts: sums.sec > 0 ? round(sums.work / sums.sec) : null,
    avgCadence: sums.pedalSec > 0 ? round(sums.cadence / sums.pedalSec) : null,
    rightPct: mean(sums.balance, 1),
    left: sidePedaling(sums.left),
    right: sidePedaling(sums.right),
  };
}

function zoneRows(bins: [number, PedalSums][], ftp: number, totalSec: number): PowerZoneRow[] {
  let floor = 0;
  return RIDE_ZONES.map((zone) => {
    const ceiling = ZONE_CEILINGS[zone.id];
    const sums = emptyPedalSums();
    for (const [watts, bin] of bins) {
      const share = (watts + POWER_BIN_W / 2) / ftp;
      if (share > floor && share <= ceiling) mergePedalSums(sums, bin);
    }
    const row: PowerZoneRow = {
      ...pedalingFrom(sums),
      id: zone.id,
      label: zone.label,
      minWatts: Math.round(floor * ftp),
      maxWatts: Number.isFinite(ceiling) ? Math.round(ceiling * ftp) : null,
      pct: totalSec > 0 ? round((sums.sec / totalSec) * 100, 1) : 0,
    };
    floor = ceiling;
    return row;
  });
}

function quadrantsFrom(
  cells: [number, number, number][],
  ftp: number,
  cadence: number | null,
): Quadrants | null {
  if (!cadence || !cells.length) return null;
  const torque = ftp / ((cadence * 2 * Math.PI) / 60);
  const sec: [number, number, number, number] = [0, 0, 0, 0];
  for (const [rpm, nm, seconds] of cells) {
    const fast = rpm + FORCE_CADENCE_BIN_RPM / 2 >= cadence;
    const strong = nm + FORCE_TORQUE_BIN_NM / 2 >= torque;
    sec[strong ? (fast ? 0 : 1) : fast ? 3 : 2] += seconds;
  }
  const total = sec.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return {
    cadence,
    torque: round(torque, 1),
    pct: sec.map((value) => round((value / total) * 100, 1)) as Quadrants["pct"],
  };
}

export function powerFileView(
  analysis: PowerFileAnalysis,
  athlete: { ftp: number | null; weightKg: number | null },
): PowerFileView {
  const ftp: Anchor | null = athlete.ftp
    ? { value: Math.round(athlete.ftp), source: "vo2" }
    : analysis.fileFtp
      ? { value: analysis.fileFtp, source: "file" }
      : null;
  const weightKg: Anchor | null = athlete.weightKg
    ? { value: athlete.weightKg, source: "vo2" }
    : analysis.fileWeightKg
      ? { value: analysis.fileWeightKg, source: "file" }
      : null;
  const overall = emptyPedalSums();
  for (const [, bin] of analysis.powerBins) mergePedalSums(overall, bin);
  const ride = summarizeRide(analysis.terrain, {
    sportType: analysis.sportType,
    movingTime: analysis.movingSec,
    averageWatts: analysis.power.avg,
    normalizedWatts: analysis.power.normalized,
    deviceWatts: true,
    ftp: ftp?.value ?? null,
  });
  const efficiency = efficiencyFactor({
    sportType: analysis.sportType,
    movingTime: analysis.movingSec,
    distance: analysis.distanceM,
    totalElevationGain: analysis.ascentM,
    averageHeartrate: analysis.heart?.avg ?? null,
    averageWatts: analysis.power.avg,
    weightedAverageWatts: analysis.power.normalized,
    deviceWatts: true,
  });
  const {
    version: _version,
    powerBins,
    seated,
    standing,
    forceCells,
    terrain: _terrain,
    power,
    ...rest
  } = analysis;
  return {
    ...rest,
    ftp,
    weightKg,
    power: {
      ...power,
      intensityFactor: ride?.intensityFactor ?? null,
      tss: ride?.tss ?? null,
      variabilityIndex: ride?.variabilityIndex ?? null,
      efficiencyFactor: efficiency ? round(efficiency.ef, 2) : null,
    },
    zones: ftp ? zoneRows(powerBins, ftp.value, overall.sec) : [],
    pedaling: {
      overall: pedalingFrom(overall),
      seated: seated?.sec ? pedalingFrom(seated) : null,
      standing: standing?.sec ? pedalingFrom(standing) : null,
    },
    forceCells,
    quadrants: ftp ? quadrantsFrom(forceCells, ftp.value, analysis.cadence?.avg ?? null) : null,
    terrain: ride,
  };
}
