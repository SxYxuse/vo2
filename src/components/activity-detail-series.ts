import type { ChartConfig } from "@/components/ui/chart";
import {
  STREAM_SERIES,
  type ActivityChartPoint,
  type StreamSeriesKey,
} from "@/services/activity-detail.types.ts";
import { isPlausibleBpm } from "@/services/heart-rate.ts";
import {
  chartLocomotionValue,
  formatPaceClock,
  locomotionFor,
  PACE_STOP_KMH,
  paceSeconds,
} from "@/services/locomotion.ts";

export type StreamYAxis = {
  reversed: boolean;
  domain: readonly [number | "auto", number | "auto"];
  ticks?: number[];
  allowDataOverflow: boolean;
  formatTick: (value: number) => string;
};

export type StreamAxisPlacement = {
  orientation: "left" | "right";
  hide: boolean;
};

const FITTED_DOMAIN = ["auto", "auto"] as const;
const FROM_ZERO_DOMAIN = [0, "auto"] as const;
const PACE_SLOW_PERCENTILE = 0.95;
/** Rolling window of moving speed before a pace-sport Stream is drawn. */
export const PACE_CHART_WINDOW_S = 60;

export function chartPointForStream(
  point: ActivityChartPoint,
  sportType: string,
): ActivityChartPoint {
  return {
    ...point,
    heartrate: isPlausibleBpm(point.heartrate) ? point.heartrate : undefined,
    speed: chartLocomotionValue(point.speed, sportType),
  };
}

function meanMovingSpeedKmh(
  chart: readonly ActivityChartPoint[],
  index: number,
  windowS: number,
): number | undefined {
  const current = chart[index];
  if (current.speed == null || current.speed < PACE_STOP_KMH) return undefined;
  const tStart = current.t - windowS;
  let sum = 0;
  let count = 0;
  for (let i = index; i >= 0; i--) {
    const sample = chart[i];
    if (sample.t < tStart) break;
    if (sample.speed != null && sample.speed >= PACE_STOP_KMH) {
      sum += sample.speed;
      count++;
    }
  }
  if (count === 0) return undefined;
  return sum / count;
}

function chartLocomotionAt(
  chart: readonly ActivityChartPoint[],
  index: number,
  sportType: string,
): number | undefined {
  const loco = locomotionFor(sportType);
  const kmh = chart[index]?.speed;
  if (loco.kind === "speed") return kmh;
  if (kmh == null || kmh <= 0) return paceSeconds(PACE_STOP_KMH, loco.unit) ?? undefined;
  if (kmh < PACE_STOP_KMH) return paceSeconds(PACE_STOP_KMH, loco.unit) ?? undefined;
  const meanKmh = meanMovingSpeedKmh(chart, index, PACE_CHART_WINDOW_S);
  if (meanKmh == null) return paceSeconds(PACE_STOP_KMH, loco.unit) ?? undefined;
  return paceSeconds(meanKmh, loco.unit) ?? undefined;
}

function clipPaceToDomain(rows: readonly ActivityChartPoint[], slow: number): ActivityChartPoint[] {
  return rows.map((row) => ({
    ...row,
    speed: typeof row.speed === "number" ? Math.min(row.speed, slow) : row.speed,
  }));
}

export function chartRowsFor(
  chart: readonly ActivityChartPoint[],
  sportType: string,
): ActivityChartPoint[] {
  const rows = chart.map((point, index) => ({
    ...chartPointForStream(point, sportType),
    speed: chartLocomotionAt(chart, index, sportType),
  }));
  const loco = locomotionFor(sportType);
  if (loco.kind !== "pace") return rows;
  const stopClock = paceSeconds(PACE_STOP_KMH, loco.unit);
  const values = streamSeriesValues(rows, "speed").filter(
    (value) => stopClock == null || value < stopClock,
  );
  const slow = paceDomain(values)[1];
  if (typeof slow !== "number") return rows;
  return clipPaceToDomain(rows, slow);
}

export function streamSeriesValues(
  rows: readonly ActivityChartPoint[],
  key: StreamSeriesKey,
): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "number") values.push(value);
  }
  return values;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function nicePaceStep(rangeS: number): number {
  if (rangeS <= 120) return 20;
  if (rangeS <= 240) return 30;
  if (rangeS <= 700) return 100;
  return 200;
}

function paceTicks(fast: number, slow: number, step: number): number[] {
  const ticks: number[] = [];
  for (let value = fast; value <= slow + 1e-6; value += step) {
    if (value > 0) ticks.push(value);
  }
  return ticks;
}

function paceDomain(values: readonly number[]): StreamYAxis["domain"] {
  return paceScale(values).domain;
}

function paceScale(values: readonly number[]): {
  domain: StreamYAxis["domain"];
  ticks?: number[];
} {
  if (values.length === 0) return { domain: FITTED_DOMAIN };
  const fastest = Math.min(...values);
  const p95 = Math.round(percentile(values, PACE_SLOW_PERCENTILE));
  const bulkSlow = Math.max(p95, fastest);
  const step = nicePaceStep(Math.max(bulkSlow - fastest, 0));
  const floored = Math.floor(fastest / step) * step;
  const fast = Math.max(step, floored === 0 ? step : floored - step);
  let slow = Math.ceil(bulkSlow / step) * step;
  if (slow <= fast) slow = fast + step;
  return { domain: [fast, slow], ticks: paceTicks(fast, slow, step) };
}

export function streamYAxis(
  key: StreamSeriesKey,
  sportType: string,
  values: readonly number[] = [],
): StreamYAxis {
  const invertPace = key === "speed" && locomotionFor(sportType).kind === "pace";
  const pace = invertPace ? paceScale(values) : null;
  return {
    reversed: invertPace,
    domain: pace
      ? pace.domain
      : key === "altitude" || key === "heartrate"
        ? FITTED_DOMAIN
        : FROM_ZERO_DOMAIN,
    ticks: pace?.ticks,
    allowDataOverflow: invertPace,
    formatTick: (value) => {
      if (!invertPace) return String(Math.round(value));
      if (value <= 0) return "";
      return formatPaceClock(value);
    },
  };
}

export function streamAxisPlacement(index: number): StreamAxisPlacement {
  if (index === 1) return { orientation: "right", hide: false };
  return { orientation: "left", hide: index > 1 };
}

export const SERIES_META: Record<
  StreamSeriesKey,
  { label: string; shortLabel: string; unit: string; color: string }
> = {
  heartrate: {
    label: "Heart rate",
    shortLabel: "HR",
    unit: "bpm",
    color: "var(--color-ds-red-700)",
  },
  watts: {
    label: "Power",
    shortLabel: "Power",
    unit: "W",
    color: "var(--color-ds-amber-700)",
  },
  cadence: {
    label: "Cadence",
    shortLabel: "Cadence",
    unit: "rpm",
    color: "var(--color-ds-purple-700)",
  },
  speed: {
    label: "Speed",
    shortLabel: "Speed",
    unit: "km/h",
    color: "var(--color-ds-blue-700)",
  },
  altitude: {
    label: "Elevation",
    shortLabel: "Elev",
    unit: "m",
    color: "var(--color-ds-green-700)",
  },
};

export function seriesMetaFor(sportType: string) {
  const loco = locomotionFor(sportType);
  return {
    ...SERIES_META,
    speed: {
      ...SERIES_META.speed,
      label: loco.label,
      shortLabel: loco.shortLabel,
      unit: loco.unit,
    },
  };
}

export function chartConfigFor(sportType: string) {
  const meta = seriesMetaFor(sportType);
  return Object.fromEntries(
    STREAM_SERIES.map((key) => [key, { label: meta[key].label, color: meta[key].color }]),
  ) satisfies ChartConfig;
}
