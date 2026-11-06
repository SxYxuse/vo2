import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { BikeIcon, CheckIcon, CircleIcon, FootprintsIcon, WavesIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { cn } from "@/lib/utils";
import { markCoachPlanSession } from "@/services/coach-plan.ts";
import { formatPaceClock } from "@/services/locomotion.ts";
import {
  EFFORTS,
  bandText,
  rideZone,
  stepAmountText,
  stepSecPerKm,
  stepSwimZone,
  stepZone,
  swimPaceText,
  swimTargetText,
  type CoachPlanState,
  type PlanSport,
  type PlannedSession,
  type PlannedStep,
} from "@/services/coach-plan.types.ts";
import { mondayOf } from "@/services/season-phase.ts";
import { PACE_TYPES, type PaceRange } from "@/services/training-paces.types.ts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/*
 * Pieces of a coach-plan session shared by the Plan view and the session page: its shape (width is
 * a run's or a swim's distance or a ride's time, height and colour depth are effort), its steps
 * with repeats, and marking it done. Runs are amber, rides blue, and swims teal, as in the coach's
 * visuals.
 */

type Level = 1 | 2 | 3 | 4 | 5;

/** The icon and colour of a session's sport. */
export const SPORT_ICON: Record<PlanSport, { icon: typeof BikeIcon; className: string }> = {
  run: { icon: FootprintsIcon, className: "text-ds-amber-700" },
  ride: { icon: BikeIcon, className: "text-ds-blue-700" },
  swim: { icon: WavesIcon, className: "text-ds-teal-700" },
};

/** A swim step with no distance is rest at the wall. */
const isSwimRest = (step: PlannedStep) => step.distanceM == null;

/** Effort 1 (walk, jog, recovery spin) to 5 (interval pace, VO2 max and up), from the target. */
function effortLevel(step: PlannedStep, sport: PlanSport): Level {
  if (step.effort === "walk") return 1;
  if (sport === "ride") return rideZone(stepZone(step)).level as Level;
  if (sport === "swim") return isSwimRest(step) ? 1 : (stepSwimZone(step).level as Level);
  if (step.part === "recovery" && (step.effort === "easy" || step.pace === "easy")) return 1;
  const pace = step.pace ?? EFFORTS.find((effort) => effort.id === step.effort)?.pace ?? "easy";
  return ({ easy: 2, marathon: 3, threshold: 4, interval: 5, repetition: 5 } as const)[pace];
}

const LEVEL_HEIGHT: Record<Level, string> = { 1: "28%", 2: "42%", 3: "60%", 4: "80%", 5: "100%" };
const LEVEL_BG: Record<PlanSport, Record<Level, string>> = {
  run: {
    1: "bg-ds-amber-300",
    2: "bg-ds-amber-500",
    3: "bg-ds-amber-700",
    4: "bg-ds-amber-800",
    5: "bg-ds-amber-900",
  },
  ride: {
    1: "bg-ds-blue-300",
    2: "bg-ds-blue-500",
    3: "bg-ds-blue-700",
    4: "bg-ds-blue-800",
    5: "bg-ds-blue-900",
  },
  swim: {
    1: "bg-ds-teal-300",
    2: "bg-ds-teal-500",
    3: "bg-ds-teal-700",
    4: "bg-ds-teal-800",
    5: "bg-ds-teal-900",
  },
};

/** Drill steps are striped, so a technique swim reads as drills and swimming, not one block. */
const DRILL_STRIPES =
  "bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/0.45)_3px_6px)]";

const rangeMiddle = (range: PaceRange) => (range.slowSecPerKm + range.fastSecPerKm) / 2;

/**
 * A step's width: a run's metres, a timed step at the middle of its pace; a ride's seconds; a
 * swim's metres, its rest at about a metre a second so a short rest stays a sliver.
 */
function stepWidth(step: PlannedStep, sport: PlanSport) {
  if (sport === "ride") return step.durationS ?? 0;
  if (sport === "swim") return step.distanceM ?? step.durationS ?? 0;
  if (step.distanceM != null) return step.distanceM;
  const secPerKm =
    step.secPerKm ?? (step.range ? rangeMiddle(step.range) : stepSecPerKm(step, null));
  return ((step.durationS ?? 0) / secPerKm) * 1000;
}

/** The session drawn as its shape. */
export function RunShape({
  run,
  height = 48,
  className,
}: {
  run: Pick<PlannedSession, "blocks" | "sport">;
  height?: number;
  className?: string;
}) {
  const segments = run.blocks.flatMap((block) =>
    Array.from({ length: block.repeat }, () => block.steps).flat(),
  );
  return (
    <div aria-hidden className={cn("flex w-full items-end gap-px", className)} style={{ height }}>
      {segments.map((step, index) => {
        const level = effortLevel(step, run.sport);
        return (
          <i
            key={index}
            className={cn(
              "block min-w-px rounded-t-[2px]",
              LEVEL_BG[run.sport][level],
              step.drill != null && DRILL_STRIPES,
            )}
            style={{ flex: stepWidth(step, run.sport), height: LEVEL_HEIGHT[level] }}
          />
        );
      })}
    </div>
  );
}

export const rangeText = (range: PaceRange) =>
  `${formatPaceClock(range.fastSecPerKm)}–${formatPaceClock(range.slowSecPerKm)}/km`;

const PART_LABEL = { warmup: "Warm-up", cooldown: "Cool-down" } as const;

/** A ride step's target: its zone, and its watts or, without power, its heart rate. */
function rideTargetText(step: PlannedStep) {
  if (step.effort === "walk") return "off the bike";
  const zone = rideZone(stepZone(step));
  if (step.watts) return `${zone.label} at ${bandText(step.watts, "W")}`;
  if (step.bpm) return `${zone.label} at ${bandText(step.bpm, "bpm")}`;
  return zone.label;
}

/**
 * "800 m at 4:15–4:20/km", "400 m jog", "Warm-up: 2 km easy", "12 min sweet spot at 230–245 W",
 * "100 m threshold at 1:44–1:47 /100m", "50 m catch-up drill, easy", "15 s rest".
 */
export function stepText(step: PlannedStep, sport: PlanSport) {
  const part =
    step.part in PART_LABEL ? `${PART_LABEL[step.part as keyof typeof PART_LABEL]}: ` : "";
  const amount = stepAmountText(step, sport);
  if (sport === "ride") return `${part}${amount} ${rideTargetText(step)}`;
  if (sport === "swim") return `${part}${amount} ${swimTargetText(step, " at ")}`;
  if (step.secPerKm != null) return `${part}${amount} at ${formatPaceClock(step.secPerKm)}/km`;
  if (step.range) return `${part}${amount} at ${rangeText(step.range)}`;
  if (step.part === "recovery" && (step.effort === "easy" || step.pace === "easy")) {
    return `${part}${amount} jog`;
  }
  const label = step.pace
    ? `${PACE_TYPES.find((pace) => pace.id === step.pace)!.label.toLowerCase()} pace`
    : (EFFORTS.find((effort) => effort.id === step.effort)?.label ?? "easy");
  return `${part}${amount} ${label}`;
}

/**
 * What the session is about, from its hardest stretch: a run's pace range, a ride's watts or heart
 * rate, a swim's pace per 100 m; null when it has none, such as a run without training paces.
 */
export function headlineTarget(run: Pick<PlannedSession, "blocks" | "sport">): string | null {
  const steps = run.blocks
    .flatMap((block) => block.steps)
    .sort((a, b) => effortLevel(b, run.sport) - effortLevel(a, run.sport));
  if (run.sport === "swim") {
    const top = steps.find((step) => step.swimPace);
    return top?.swimPace ? swimPaceText(top.swimPace) : null;
  }
  if (run.sport === "ride") {
    const top = steps.find((step) => step.watts || step.bpm);
    if (!top) return null;
    return top.watts ? bandText(top.watts, "W") : bandText(top.bpm!, "bpm");
  }
  const top = steps.find((step) => step.secPerKm != null || step.range);
  if (top?.secPerKm != null) return `${formatPaceClock(top.secPerKm)}/km`;
  return top?.range ? rangeText(top.range) : null;
}

/** The steps, a repeated block as one line: "6 × 800 m at 4:15–4:20/km, 400 m jog". */
export function RunSteps({ run }: { run: Pick<PlannedSession, "blocks" | "sport"> }) {
  const level = (steps: PlannedStep[]) =>
    Math.max(...steps.map((step) => effortLevel(step, run.sport))) as Level;
  return (
    <ol className="flex flex-col">
      {run.blocks.map((block, index) => (
        <li key={index} className="flex gap-3 border-t py-2.5 first:border-t-0 first:pt-0">
          <span
            aria-hidden
            className={cn(
              "w-1 shrink-0 self-stretch rounded-full",
              LEVEL_BG[run.sport][level(block.steps)],
            )}
          />
          <div className="flex min-w-0 flex-col gap-0.5 text-xs">
            {block.repeat > 1 ? (
              <span className="font-medium">
                {block.repeat} × {block.steps.map((step) => stepText(step, run.sport)).join(", ")}
              </span>
            ) : (
              block.steps.map((step, stepIndex) => (
                <span key={stepIndex} className="font-medium">
                  {stepText(step, run.sport)}
                </span>
              ))
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "This week", or "Week of 22 Jun". */
export const weekLabel = (weekStart: string, today: string) =>
  weekStart === mondayOf(today) ? "This week" : `Week of ${format(parseISO(weekStart), "d MMM")}`;

/**
 * Marks a session done, or open again (ADR 0048). Shown from the session's week on; a week ahead
 * may still be written again. Off while offline, and while the plan is being written, since the
 * writing would store the plan it read and drop the mark.
 */
export function DoneToggle({
  run,
  state,
  className,
}: {
  run: PlannedSession;
  state: CoachPlanState;
  className?: string;
}) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: (done: boolean) => markCoachPlanSession({ data: { sessionId: run.id, done } }),
    onSuccess: (next) => queryClient.setQueryData(coachPlanQueryOptions.queryKey, next),
  });
  if (run.weekStart > mondayOf(state.today)) return null;
  const done = run.done === true;
  const reason = !online
    ? "Offline: it can be marked once you're back online."
    : state.status === "writing"
      ? "Your plan is being written again: mark it once it's written."
      : mark.error
        ? "Could not save. Nothing was saved."
        : null;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Button
        type="button"
        variant={done ? "secondary" : "outline"}
        aria-pressed={done}
        disabled={!online || mark.isPending || state.status === "writing"}
        onClick={() => mark.mutate(!done)}
      >
        {mark.isPending ? (
          <Spinner data-icon="inline-start" />
        ) : done ? (
          <CheckIcon data-icon="inline-start" className="text-success" />
        ) : (
          <CircleIcon data-icon="inline-start" />
        )}
        {done ? "Done" : "Mark done"}
      </Button>
      {reason ? (
        <p className={cn("text-xs", mark.error ? "text-destructive" : "text-muted-foreground")}>
          {reason}
        </p>
      ) : null}
    </div>
  );
}
