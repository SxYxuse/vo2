import type { ChartConfig } from "@/components/ui/chart";
import { STREAM_SERIES, type StreamSeriesKey } from "@/services/activity-detail.ts";
import { formatPaceClock, locomotionFor } from "@/services/locomotion.ts";

export type StreamYAxis = {
  reversed: boolean;
  domain: readonly [number | "auto", number | "auto"];
  formatTick: (value: number) => string;
};

export type StreamAxisPlacement = {
  orientation: "left" | "right";
  hide: boolean;
};

const FITTED_DOMAIN = ["auto", "auto"] as const;
const FROM_ZERO_DOMAIN = [0, "auto"] as const;

export function streamYAxis(key: StreamSeriesKey, sportType: string): StreamYAxis {
  const invertPace = key === "speed" && locomotionFor(sportType).kind === "pace";
  return {
    reversed: invertPace,
    domain: key === "altitude" || invertPace ? FITTED_DOMAIN : FROM_ZERO_DOMAIN,
    formatTick: (value) => (invertPace ? formatPaceClock(value) : String(Math.round(value))),
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
