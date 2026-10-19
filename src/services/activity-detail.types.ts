import { normalizedPowerFromWatts } from "./normalized-power.ts";

export const STREAM_SERIES = ["heartrate", "watts", "cadence", "speed", "altitude"] as const;

export type StreamSeriesKey = (typeof STREAM_SERIES)[number];

export type ActivityChartPoint = {
  t: number;
  heartrate?: number;
  watts?: number;
  cadence?: number;
  speed?: number;
  altitude?: number;
};

export type ActivityKpis = {
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgWatts: number | null;
  normalizedWatts: number | null;
  maxWatts: number | null;
  avgCadence: number | null;
  avgSpeed: number | null;
};

export type ActivityDetail = {
  id: string;
  title: string;
  sportType: string;
  start: string;
  movingTime: number;
  elapsedTime: number;
  distance: number | null;
  totalElevationGain: number | null;
  hasStreams: boolean;
  kpis: ActivityKpis;
  series: StreamSeriesKey[];
  chart: ActivityChartPoint[];
};

export type ActivityChartPreview = {
  series: StreamSeriesKey[];
  chart: ActivityChartPoint[];
  kpis: ActivityKpis;
};

export type StreamChartInput = {
  time: number[] | null;
  heartrate: number[] | null;
  watts: number[] | null;
  cadence: number[] | null;
  velocitySmooth: number[] | null;
  altitude: number[] | null;
};

const MAX_CHART_POINTS = 480;

function meanPositive(values: number[] | null): number | null {
  if (!values?.length) return null;
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (value > 0) {
      sum += value;
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

function maxPositive(values: number[] | null): number | null {
  if (!values?.length) return null;
  let max = 0;
  let found = false;
  for (const value of values) {
    if (value > 0 && (!found || value > max)) {
      max = value;
      found = true;
    }
  }
  return found ? max : null;
}

function hasValues(values: number[] | null | undefined) {
  return Boolean(values?.some((value) => value > 0));
}

function pickIndexes(length: number, maxPoints: number) {
  if (length <= maxPoints) {
    return Array.from({ length }, (_, index) => index);
  }
  const step = (length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => Math.round(index * step));
}

export function buildChartPreview(input: StreamChartInput): ActivityChartPreview {
  const heartrate = input.heartrate;
  const watts = input.watts;
  const cadence = input.cadence;
  const velocity = input.velocitySmooth;
  const altitude = input.altitude;
  const time = input.time;

  const series: StreamSeriesKey[] = STREAM_SERIES.filter((key) => {
    if (key === "heartrate") return hasValues(heartrate);
    if (key === "watts") return hasValues(watts);
    if (key === "cadence") return hasValues(cadence);
    if (key === "speed") return hasValues(velocity);
    return altitude != null && altitude.length > 0;
  });

  const length = Math.max(
    time?.length ?? 0,
    heartrate?.length ?? 0,
    watts?.length ?? 0,
    cadence?.length ?? 0,
    velocity?.length ?? 0,
    altitude?.length ?? 0,
  );
  const indexes = length > 0 ? pickIndexes(length, MAX_CHART_POINTS) : [];
  const chart: ActivityChartPoint[] = indexes.map((index) => {
    const point: ActivityChartPoint = { t: time?.[index] ?? index };
    const hr = heartrate?.[index];
    const power = watts?.[index];
    const rpm = cadence?.[index];
    const speedMs = velocity?.[index];
    const elev = altitude?.[index];
    if (hr != null) point.heartrate = Math.round(hr);
    if (power != null) point.watts = Math.round(power);
    if (rpm != null) point.cadence = Math.round(rpm);
    if (speedMs != null) point.speed = Math.round(speedMs * 36) / 10;
    if (elev != null) point.altitude = Math.round(elev * 10) / 10;
    return point;
  });

  const avgSpeedMs = meanPositive(velocity);
  return {
    series,
    chart,
    kpis: {
      avgHeartrate: meanPositive(heartrate),
      maxHeartrate: maxPositive(heartrate),
      avgWatts: meanPositive(watts),
      normalizedWatts: normalizedPowerFromWatts(watts, time),
      maxWatts: maxPositive(watts),
      avgCadence: meanPositive(cadence),
      avgSpeed: avgSpeedMs == null ? null : avgSpeedMs * 3.6,
    },
  };
}

export function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatDistanceKm(meters: number | null) {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
}

export function formatElevation(meters: number | null) {
  if (meters == null) return "—";
  return `${Math.round(meters)} m`;
}

export function formatSpeed(kmh: number | null) {
  if (kmh == null) return "—";
  return `${kmh.toFixed(1)} km/h`;
}

export function formatBpm(value: number | null) {
  if (value == null) return "—";
  return `${Math.round(value)} bpm`;
}

export function formatWatts(value: number | null) {
  if (value == null) return "—";
  return `${Math.round(value)} W`;
}

export function formatCadence(value: number | null) {
  if (value == null) return "—";
  return `${Math.round(value)} rpm`;
}

export function formatElapsedTick(seconds: number) {
  if (!Number.isFinite(seconds)) return "";
  return formatDuration(Math.max(0, seconds));
}

const CLOCK = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });
const DATE_FULL = new Intl.DateTimeFormat("en-US", { dateStyle: "full" });
const DATE_TIME_MED = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatActivityClockRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  if (start.toDateString() !== end.toDateString()) {
    return `${DATE_TIME_MED.format(start)} – ${DATE_TIME_MED.format(end)}`;
  }
  return `${CLOCK.format(start)} – ${CLOCK.format(end)}`;
}

export function formatActivitySchedule(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return "";
  if (Number.isNaN(end.getTime())) {
    return start.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
  }
  if (start.toDateString() !== end.toDateString()) {
    return `${DATE_TIME_MED.format(start)} – ${DATE_TIME_MED.format(end)}`;
  }
  return `${DATE_FULL.format(start)} · ${CLOCK.format(start)} – ${CLOCK.format(end)}`;
}
