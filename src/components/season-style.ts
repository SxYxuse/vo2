import type { PhaseKind } from "@/services/season-phase.ts";
import type { GoalPriority } from "@/services/season.types.ts";

/*
 * Colour marks a phase or a priority only: on the season map and as a small dot next to its
 * label. Phases climb one purple ramp toward the peak, then turn pink for the taper and red on
 * race week; sports already own blue, amber, teal, and green, so the two never read as each other.
 */
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

/** Phases shown in the map legend, in season order. */
export const LEGEND_PHASES: PhaseKind[] = ["base", "build", "peak", "taper", "race", "recovery"];

export const PRIORITY_FILL: Record<GoalPriority, string> = {
  A: "var(--ds-red-700)",
  B: "var(--ds-pink-600)",
  C: "var(--ds-gray-500)",
};

/** Race-day form as text colour, the same tones as the fitness chart. */
export function formTone(form: number) {
  if (form >= 5) return "text-success";
  if (form >= -10) return "text-muted-foreground";
  return "text-destructive";
}
