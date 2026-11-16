import type { PhaseKind } from "@/services/season-phase.ts";
import type { GoalPriority } from "@/services/season.types.ts";

export const PHASE_FILL: Record<PhaseKind, string> = {
  hold: "var(--ds-gray-500)",
  base: "var(--ds-purple-400)",
  build: "var(--ds-purple-600)",
  maintain: "var(--ds-purple-500)",
  peak: "var(--ds-purple-800)",
  taper: "var(--ds-pink-600)",
  race: "var(--ds-red-700)",
  recovery: "var(--ds-gray-600)",
};

export const LEGEND_PHASES: PhaseKind[] = ["base", "build", "peak", "taper", "race", "recovery"];

export const PRIORITY_FILL: Record<GoalPriority, string> = {
  A: "var(--ds-red-700)",
  B: "var(--ds-pink-600)",
};
