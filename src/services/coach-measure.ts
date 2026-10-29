import { isSwimSport, movingClock, type DistanceSport } from "./best-efforts.ts";
import { isCyclingSport } from "./training-load.ts";

export type MeasureStreams = {
  time: number[] | null;
  distance: number[] | null;
  heartrate: number[] | null;
  altitude: number[] | null;
  watts: number[] | null;
};

export type MeasureRequest =
  | { kind: "range"; unit: "metres" | "seconds"; start: number; end: number }
  | { kind: "splits" | "fastest"; unit: "metres" | "seconds"; length: number };

/** One stretch of an activity. Seconds are moving time; pauses are left out. */
export type Measure = {
  startM: number;
  endM: number;
  distanceM: number;
  startS: number;
  seconds: number;
  paceSecPerKm: number | null;
  speedKmh: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgWatts: number | null;
  elevationGainM: number | null;
};

export type MeasureResult = { measures: Measure[]; note?: string };

const MAX_SPLITS = 200;

function distanceSport(sportType: string): DistanceSport {
  if (isSwimSport(sportType)) return "swim";
  if (isCyclingSport(sportType)) return "ride";
  return "run";
}

/** The fractional sample index where a rising series first reaches `value`. */
function positionOf(series: number[], value: number) {
  if (value <= series[0]) return 0;
  const last = series.length - 1;
  if (value >= series[last]) return last;
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (series[mid] < value) low = mid;
    else high = mid;
  }
  const span = series[high] - series[low];
  return span > 0 ? low + (value - series[low]) / span : high;
}

function valueAt(series: number[], position: number) {
  const low = Math.floor(position);
  const high = Math.min(series.length - 1, low + 1);
  return series[low] + (series[high] - series[low]) * (position - low);
}

function samplesBetween(series: number[] | null, from: number, to: number) {
  if (!series?.length) return [];
  return series.slice(Math.floor(from), Math.ceil(to) + 1).filter(Number.isFinite);
}

function mean(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function climbed(altitude: number[]) {
  if (altitude.length < 2) return null;
  let gain = 0;
  for (let index = 1; index < altitude.length; index += 1) {
    gain += Math.max(0, altitude[index] - altitude[index - 1]);
  }
  return Math.round(gain);
}

function measureBetween(
  streams: MeasureStreams & { distance: number[] },
  clock: number[],
  from: number,
  to: number,
): Measure {
  const startM = valueAt(streams.distance, from);
  const endM = valueAt(streams.distance, to);
  const startS = valueAt(clock, from);
  const seconds = valueAt(clock, to) - startS;
  const distanceM = endM - startM;
  const heartrate = samplesBetween(streams.heartrate, from, to);
  return {
    startM: Math.round(startM),
    endM: Math.round(endM),
    distanceM: Math.round(distanceM),
    startS: Math.round(startS),
    seconds: Math.round(seconds),
    paceSecPerKm: distanceM > 0 ? Math.round((seconds / distanceM) * 1000) : null,
    speedKmh: seconds > 0 ? Math.round((distanceM / seconds) * 36) / 10 : null,
    avgHeartrate: mean(heartrate),
    maxHeartrate: heartrate.length ? Math.max(...heartrate) : null,
    avgWatts: mean(samplesBetween(streams.watts, from, to)),
    elevationGainM: climbed(samplesBetween(streams.altitude, from, to)),
  };
}

/** The window of `length` (metres or seconds) with the least time or the most distance. */
function fastestWindow(axis: number[], other: number[], length: number, byDistance: boolean) {
  let best: { from: number; to: number; score: number } | null = null;
  for (let to = 1; to < axis.length; to += 1) {
    const startValue = axis[to] - length;
    if (startValue < axis[0]) continue;
    const from = positionOf(axis, startValue);
    const covered = other[to] - valueAt(other, from);
    const score = byDistance ? -covered : covered;
    if (covered > 0 && (!best || score < best.score)) best = { from, to, score };
  }
  return best;
}

/**
 * Exact numbers over an activity's streams, so the coach never does arithmetic on raw samples:
 * a range from the start, even splits, or the fastest stretch of a distance or duration.
 */
export function measureActivity(
  streams: MeasureStreams,
  sportType: string,
  request: MeasureRequest,
): MeasureResult {
  const { time, distance } = streams;
  if (!time?.length || !distance?.length || time.length !== distance.length) {
    return { measures: [], note: "This activity has no time and distance streams to measure." };
  }
  const withDistance = { ...streams, distance };
  const clock = movingClock(distance, time, distanceSport(sportType));
  const axis = request.unit === "metres" ? distance : clock;
  const total = axis[axis.length - 1] - axis[0];

  if (request.kind === "range") {
    const from = positionOf(axis, axis[0] + request.start);
    const to = positionOf(axis, axis[0] + request.end);
    if (to <= from) return { measures: [], note: "The range is empty or past the end." };
    const measures = [measureBetween(withDistance, clock, from, to)];
    // Without this, "time at 10 km" on a shorter run would quietly read as the whole run.
    if (request.end > total) {
      return {
        measures,
        note: `The activity ends at ${Math.round(total)} ${request.unit}; this is measured to the end.`,
      };
    }
    return { measures };
  }

  if (!(request.length > 0) || request.length > total) {
    return {
      measures: [],
      note: `The activity is shorter than ${request.length} ${request.unit}.`,
    };
  }

  if (request.kind === "fastest") {
    const other = request.unit === "metres" ? clock : distance;
    const window = fastestWindow(axis, other, request.length, request.unit === "seconds");
    return window
      ? { measures: [measureBetween(withDistance, clock, window.from, window.to)] }
      : { measures: [], note: "No stretch that long was found." };
  }

  const measures: Measure[] = [];
  for (let start = 0; start < total && measures.length < MAX_SPLITS; start += request.length) {
    const from = positionOf(axis, axis[0] + start);
    const to = positionOf(axis, axis[0] + Math.min(total, start + request.length));
    if (to > from) measures.push(measureBetween(withDistance, clock, from, to));
  }
  return { measures };
}

export const STREAM_CHANNELS = [
  "heartrate",
  "watts",
  "altitude",
  "speed",
  "cadence",
  "grade",
] as const;
export type StreamChannel = (typeof STREAM_CHANNELS)[number];

/** The most points per channel the coach gets: it types each one into a visual (ADR 0035). */
export const MAX_STREAM_POINTS = 150;

type ChannelStreams = { time: number[] | null; distance: number[] | null } & Partial<
  Record<StreamChannel, number[] | null>
>;

function round(value: number | null, digits: number) {
  if (value == null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * At most `points` samples per channel against distance and elapsed time. The first and last
 * samples are kept; each point between is the mean of its stretch, so a spike can't stand in
 * for a whole stretch.
 */
export function downsampleStreams(
  streams: ChannelStreams,
  channels: readonly StreamChannel[],
  points = MAX_STREAM_POINTS,
) {
  const length = streams.time?.length ?? 0;
  const count = Math.max(2, Math.min(points, MAX_STREAM_POINTS, length));
  const inner = count - 2;
  const pick = (series: number[] | null | undefined) => {
    if (!series || series.length !== length) return null;
    if (length <= count) return series.map((value) => value);
    const out: (number | null)[] = [series[0]];
    for (let bucket = 0; bucket < inner; bucket += 1) {
      const from = 1 + Math.floor((bucket * (length - 2)) / inner);
      const to = 1 + Math.floor(((bucket + 1) * (length - 2)) / inner);
      const values = series.slice(from, Math.max(from + 1, to)).filter(Number.isFinite);
      out.push(
        values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      );
    }
    out.push(series[length - 1]);
    return out;
  };

  const series: Partial<Record<StreamChannel, (number | null)[]>> = {};
  const missing: StreamChannel[] = [];
  for (const channel of channels) {
    const values = pick(streams[channel]);
    if (values) series[channel] = values.map((value) => round(value, 1));
    else missing.push(channel);
  }
  const distance = pick(streams.distance) ?? [];
  const time = pick(streams.time) ?? [];
  return {
    points: time.length,
    distanceKm: distance.map((metres) => round(metres == null ? null : metres / 1000, 2)),
    elapsedS: time.map((seconds) => round(seconds, 0)),
    series,
    missing,
  };
}
