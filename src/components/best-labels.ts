import { formatDuration } from "@/services/activity-detail.types.ts";
import { RUN_DISTANCES } from "@/services/best-efforts.ts";
import type { Board } from "@/services/personal-bests.ts";

const RUN_LABEL = new Map<number, string>(
  RUN_DISTANCES.map((metres, index) => [
    metres,
    [
      "400 m",
      "1 km",
      "1 mile",
      "2 miles",
      "5 km",
      "5 miles",
      "10 km",
      "10 miles",
      "Half marathon",
      "Marathon",
    ][index],
  ]),
);

export function runDistanceLabel(metres: number) {
  return RUN_LABEL.get(metres) ?? `${Number((metres / 1000).toFixed(1))} km`;
}

const DAYS_LABEL = { longest: "Longest", climbing: "Most climbing", climb: "Biggest climb" };

export function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = (seconds % 3600) / 60;
  return minutes ? `${hours} h ${minutes}` : `${hours} h`;
}

export function boardLabel(board: Pick<Board, "sport" | "kind" | "key">) {
  if (board.kind === "power") return durationLabel(board.key);
  if (board.kind !== "time") return DAYS_LABEL[board.kind];
  const known = board.sport === "running" ? RUN_LABEL.get(board.key) : undefined;
  if (known) return known;
  return board.key >= 1000 && board.sport !== "swimming"
    ? `${board.key / 1000} km`
    : `${board.key} m`;
}

export function formatKm(metres: number) {
  return `${(metres / 1000).toFixed(1)} km`;
}

function formatMetres(metres: number) {
  return `${Math.round(metres).toLocaleString("en-US")} m`;
}

export function formatValue(board: Pick<Board, "sport" | "kind">, value: number) {
  if (board.kind === "time") return formatDuration(value);
  if (board.kind === "power") return `${value} W`;
  if (board.kind === "longest") {
    return board.sport === "swimming" ? formatMetres(value) : formatKm(value);
  }
  return formatMetres(value);
}
