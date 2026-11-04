import { PHASES, type PhaseKind } from "@/services/season-phase.ts";
import { goalWeightLabel, type GoalEffort, type GoalPriority } from "@/services/season.types.ts";
import { PHASE_FILL, PRIORITY_FILL } from "@/components/season-style.ts";
import { Badge } from "@/components/ui/badge";

export function Dot({ fill }: { fill: string }) {
  return (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: fill }} />
  );
}

/** The phase as an outline badge with its colour. */
export function PhaseBadge({ kind, lighter = false }: { kind: PhaseKind; lighter?: boolean }) {
  return (
    <Badge variant="outline">
      <Dot fill={PHASE_FILL[kind]} />
      {PHASES[kind].label}
      {lighter ? ", lighter" : ""}
    </Badge>
  );
}

/** A goal's weight as an outline badge: "Main", or a supporting race's effort, with its colour. */
export function PriorityBadge({
  priority,
  effort,
}: {
  priority: GoalPriority;
  effort: GoalEffort | null;
}) {
  const label = goalWeightLabel({ priority, effort });
  return (
    <Badge
      variant="outline"
      aria-label={priority === "A" ? "Main goal" : `Supporting race, ${label.toLowerCase()}`}
    >
      <Dot fill={PRIORITY_FILL[priority]} />
      {label}
    </Badge>
  );
}
