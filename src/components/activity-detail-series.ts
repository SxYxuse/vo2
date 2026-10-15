import type { ChartConfig } from "@/components/ui/chart";
import { STREAM_SERIES, type StreamSeriesKey } from "#/services/activity-detail.ts";

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

export const CHART_CONFIG = Object.fromEntries(
  STREAM_SERIES.map((key) => [
    key,
    { label: SERIES_META[key].label, color: SERIES_META[key].color },
  ]),
) satisfies ChartConfig;
