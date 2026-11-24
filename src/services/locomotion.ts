import { formatSpeed, type StreamSeriesKey } from "./activity-detail.types.ts";
import { sportGroupFor } from "./sport-groups.ts";

export type PaceUnit = "/km" | "/100m";

export type Locomotion =
  | {
      kind: "pace";
      unit: PaceUnit;
      label: "Pace";
      shortLabel: "Pace";
      kpiLabel: "Avg pace";
    }
  | {
      kind: "speed";
      unit: "km/h";
      label: "Speed";
      shortLabel: "Speed";
      kpiLabel: "Avg speed";
    };

const PACE_KM: Locomotion = {
  kind: "pace",
  unit: "/km",
  label: "Pace",
  shortLabel: "Pace",
  kpiLabel: "Avg pace",
};

const PACE_100M: Locomotion = {
  kind: "pace",
  unit: "/100m",
  label: "Pace",
  shortLabel: "Pace",
  kpiLabel: "Avg pace",
};

const SPEED: Locomotion = {
  kind: "speed",
  unit: "km/h",
  label: "Speed",
  shortLabel: "Speed",
  kpiLabel: "Avg speed",
};

export function locomotionFor(sportType: string): Locomotion {
  const group = sportGroupFor(sportType)?.id;
  if (group === "running" || group === "walking") return PACE_KM;
  if (group === "swimming") return PACE_100M;
  return SPEED;
}

export function defaultVisibleSeries(detail: {
  sportType: string;
  series: readonly StreamSeriesKey[];
}) {
  const offByDefault = new Set<StreamSeriesKey>(["cadence"]);
  if (locomotionFor(detail.sportType).kind !== "pace") offByDefault.add("speed");
  if (sportGroupFor(detail.sportType)?.id === "running") offByDefault.add("watts");
  return detail.series.filter((key) => !offByDefault.has(key));
}

export const PACE_STOP_KMH = 1;

export function paceSeconds(kmh: number | null, unit: PaceUnit): number | null {
  if (kmh == null || !(kmh > 0)) return null;
  const secondsPerUnit = unit === "/km" ? 3600 / kmh : 360 / kmh;
  return Math.round(secondsPerUnit);
}

export function formatPaceClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatLocomotion(kmh: number | null, sportType: string) {
  const loco = locomotionFor(sportType);
  if (loco.kind === "speed") return formatSpeed(kmh);
  const seconds = paceSeconds(kmh, loco.unit);
  if (seconds == null) return "—";
  return `${formatPaceClock(seconds)} ${loco.unit}`;
}

export function chartLocomotionValue(kmh: number | undefined, sportType: string) {
  const loco = locomotionFor(sportType);
  if (loco.kind === "speed") return kmh;
  if (kmh == null || kmh < PACE_STOP_KMH) return undefined;
  const seconds = paceSeconds(kmh, loco.unit);
  return seconds ?? undefined;
}
