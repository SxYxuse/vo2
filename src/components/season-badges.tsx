import { PHASES, type PhaseKind } from "@/services/season-phase.ts";
import type { GoalPriority } from "@/services/season.types.ts";
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

/** A goal's priority as an outline badge: "A", "B", or "C" with its colour. */
export function PriorityBadge({ priority }: { priority: GoalPriority }) {
  return (
    <Badge variant="outline" aria-label={`${priority} race`}>
      <Dot fill={PRIORITY_FILL[priority]} />
      {priority}
    </Badge>
  );
}
