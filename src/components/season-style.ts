import type { PhaseKind } from "@/services/season-phase.ts";
import type { GoalPriority } from "@/services/season.types.ts";

/*
 * Phases climb one purple ramp toward the peak, then turn pink for the taper and red on race
 * week. Sports already own blue, amber, teal, and green, so the two never read as each other.
 */
export const PHASE_STYLE: Record<PhaseKind, { fill: string; chip: string }> = {
  hold: { fill: "var(--ds-gray-500)", chip: "bg-ds-gray-200 text-ds-gray-1000" },
  base: { fill: "var(--ds-purple-400)", chip: "bg-ds-purple-200 text-ds-purple-900" },
  build: { fill: "var(--ds-purple-600)", chip: "bg-ds-purple-300 text-ds-purple-1000" },
  maintain: { fill: "var(--ds-purple-500)", chip: "bg-ds-purple-200 text-ds-purple-1000" },
  peak: { fill: "var(--ds-purple-800)", chip: "bg-ds-purple-700 text-white" },
  taper: { fill: "var(--ds-pink-600)", chip: "bg-ds-pink-200 text-ds-pink-1000" },
  race: { fill: "var(--ds-red-700)", chip: "bg-ds-red-700 text-white" },
  recovery: { fill: "var(--ds-gray-600)", chip: "bg-ds-gray-200 text-ds-gray-1000" },
};

/** Phases shown in the map legend, in season order. */
export const LEGEND_PHASES: PhaseKind[] = ["base", "build", "peak", "taper", "race", "recovery"];

export const PRIORITY_STYLE: Record<GoalPriority, { stripe: string; badge: string; fill: string }> =
  {
    A: { stripe: "bg-ds-red-700", badge: "bg-ds-red-700 text-white", fill: "var(--ds-red-700)" },
    B: { stripe: "bg-ds-pink-600", badge: "bg-ds-pink-600 text-white", fill: "var(--ds-pink-600)" },
    C: {
      stripe: "bg-ds-gray-500",
      badge: "bg-ds-gray-300 text-ds-gray-1000",
      fill: "var(--ds-gray-500)",
    },
  };

/** Race-day form: fresh is what a taper is for; very negative means arriving tired. */
export function formTone(form: number) {
  if (form >= 5) return "bg-success/15 text-success";
  if (form >= -10) return "bg-muted text-muted-foreground";
  return "bg-destructive/15 text-destructive";
}
