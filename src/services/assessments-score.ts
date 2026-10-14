export type AssessmentResult = {
  ftpWatts: number | null;
  cyclingLthr: number | null;
  runLthr: number | null;
  vo2max: number | null;
  lastStage: number | null;
  lastStageSpeedKmh: number | null;
  peakHr: number | null;
  meanPower20Min: number | null;
};

export const EMPTY_ASSESSMENT_RESULT: AssessmentResult = {
  ftpWatts: null,
  cyclingLthr: null,
  runLthr: null,
  vo2max: null,
  lastStage: null,
  lastStageSpeedKmh: null,
  peakHr: null,
  meanPower20Min: null,
};

type Sample = { t: number; v: number };

function paired(time: number[] | null | undefined, values: number[] | null | undefined): Sample[] {
  if (!time?.length || !values?.length) return [];
  const length = Math.min(time.length, values.length);
  const samples: Sample[] = [];
  for (let index = 0; index < length; index += 1) {
    const t = time[index];
    const v = values[index];
    if (Number.isFinite(t) && Number.isFinite(v) && v > 0) samples.push({ t, v });
  }
  return samples;
}

function meanBetween(samples: Sample[], start: number, end: number) {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (sample.t >= start && sample.t <= end) {
      sum += sample.v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function peakOf(samples: Sample[]) {
  let peak = 0;
  let found = false;
  for (const sample of samples) {
    if (!found || sample.v > peak) {
      peak = sample.v;
      found = true;
    }
  }
  return found ? peak : null;
}

export function bestMeanWindow(
  time: number[] | null | undefined,
  values: number[] | null | undefined,
  windowSec: number,
): { mean: number; start: number; end: number } | null {
  const samples = paired(time, values);
  if (samples.length < 2) return null;
  const minWindow = windowSec * 0.9;
  let left = 0;
  let sum = 0;
  let count = 0;
  let best: { mean: number; start: number; end: number } | null = null;
  for (let right = 0; right < samples.length; right += 1) {
    sum += samples[right].v;
    count += 1;
    while (left < right && samples[right].t - samples[left].t > windowSec) {
      sum -= samples[left].v;
      count -= 1;
      left += 1;
    }
    const duration = samples[right].t - samples[left].t;
    if (duration >= minWindow && count > 0) {
      const mean = sum / count;
      if (!best || mean > best.mean) {
        best = { mean, start: samples[left].t, end: samples[right].t };
      }
    }
  }
  return best;
}

function lastWindow(
  samples: Sample[],
  windowSec: number,
): { mean: number; start: number; end: number } | null {
  if (samples.length < 2) return null;
  const end = samples[samples.length - 1].t;
  const start = end - windowSec;
  const mean = meanBetween(samples, start, end);
  if (mean == null) return null;
  return { mean, start: Math.max(samples[0].t, start), end };
}

function round(value: number | null, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function scoreFtp20(input: {
  time: number[] | null;
  watts: number[] | null;
  heartrate: number[] | null;
}): AssessmentResult {
  const power = bestMeanWindow(input.time, input.watts, 20 * 60);
  const hrSamples = paired(input.time, input.heartrate);
  const cyclingLthr =
    power != null ? meanBetween(hrSamples, power.start, power.end) : peakOf(hrSamples);
  return {
    ...EMPTY_ASSESSMENT_RESULT,
    meanPower20Min: round(power?.mean ?? null),
    ftpWatts: round(power ? power.mean * 0.95 : null),
    cyclingLthr: round(cyclingLthr),
    peakHr: round(peakOf(hrSamples)),
  };
}

export function scoreRunLthr(input: {
  time: number[] | null;
  heartrate: number[] | null;
}): AssessmentResult {
  const samples = paired(input.time, input.heartrate);
  const thirty = bestMeanWindow(input.time, input.heartrate, 30 * 60);
  const window = thirty
    ? {
        start: Math.max(thirty.start, thirty.end - 20 * 60),
        end: thirty.end,
      }
    : lastWindow(samples, 20 * 60);
  const runLthr = window ? meanBetween(samples, window.start, window.end) : null;
  return {
    ...EMPTY_ASSESSMENT_RESULT,
    runLthr: round(runLthr),
    peakHr: round(peakOf(samples)),
  };
}

export function scoreBeepTest(input: {
  time: number[] | null;
  heartrate: number[] | null;
  lastStage: number | null;
  age: number | null;
  vo2max: (speedKmh: number, age: number | null) => number;
  stageSpeed: (stage: number) => number;
}): AssessmentResult {
  const samples = paired(input.time, input.heartrate);
  const lastStage =
    input.lastStage != null && Number.isFinite(input.lastStage) && input.lastStage >= 1
      ? Math.round(input.lastStage * 2) / 2
      : null;
  const lastStageSpeedKmh = lastStage != null ? input.stageSpeed(lastStage) : null;
  const vo2max =
    lastStageSpeedKmh != null ? input.vo2max(lastStageSpeedKmh, input.age) : null;
  return {
    ...EMPTY_ASSESSMENT_RESULT,
    lastStage,
    lastStageSpeedKmh: round(lastStageSpeedKmh, 1),
    vo2max: round(vo2max, 1),
    peakHr: round(peakOf(samples)),
  };
}

export function isAssessmentResult(value: unknown): value is AssessmentResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return "ftpWatts" in row || "runLthr" in row || "vo2max" in row || "peakHr" in row;
}

export function parseAssessmentResult(value: unknown): AssessmentResult {
  if (!isAssessmentResult(value)) return { ...EMPTY_ASSESSMENT_RESULT };
  const row = value as AssessmentResult;
  return {
    ftpWatts: row.ftpWatts ?? null,
    cyclingLthr: row.cyclingLthr ?? null,
    runLthr: row.runLthr ?? null,
    vo2max: row.vo2max ?? null,
    lastStage: row.lastStage ?? null,
    lastStageSpeedKmh: row.lastStageSpeedKmh ?? null,
    peakHr: row.peakHr ?? null,
    meanPower20Min: row.meanPower20Min ?? null,
  };
}
