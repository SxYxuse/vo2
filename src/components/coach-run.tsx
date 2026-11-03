import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CheckIcon, CircleIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { cn } from "@/lib/utils";
import { markCoachPlanSession } from "@/services/coach-plan.ts";
import { formatPaceClock } from "@/services/locomotion.ts";
import {
  EFFORTS,
  stepAmountText,
  stepSecPerKm,
  type CoachPlanState,
  type PlannedRun,
  type PlannedStep,
} from "@/services/coach-plan.types.ts";
import { mondayOf } from "@/services/season-phase.ts";
import { PACE_TYPES, type PaceRange } from "@/services/training-paces.types.ts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/*
 * Pieces of a coach-plan run shared by the Plan view and the session page: its shape (width is
 * distance, height and amber depth are effort), its steps with repeats, and marking it done.
 */

type Level = 1 | 2 | 3 | 4 | 5;

/** Effort 1 (walk, jog) to 5 (interval and repetition pace), from the step's pace or effort. */
function effortLevel(step: PlannedStep): Level {
  if (step.effort === "walk") return 1;
  if (step.part === "recovery" && (step.effort === "easy" || step.pace === "easy")) return 1;
  const pace = step.pace ?? EFFORTS.find((effort) => effort.id === step.effort)?.pace ?? "easy";
  return ({ easy: 2, marathon: 3, threshold: 4, interval: 5, repetition: 5 } as const)[pace];
}

const LEVEL_STYLE: Record<Level, { height: string; bg: string }> = {
  1: { height: "28%", bg: "bg-ds-amber-300" },
  2: { height: "42%", bg: "bg-ds-amber-500" },
  3: { height: "60%", bg: "bg-ds-amber-700" },
  4: { height: "80%", bg: "bg-ds-amber-800" },
  5: { height: "100%", bg: "bg-ds-amber-900" },
};

const rangeMiddle = (range: PaceRange) => (range.slowSecPerKm + range.fastSecPerKm) / 2;

/** A step's distance in metres; a timed step at the middle of its pace. */
function stepMetres(step: PlannedStep) {
  if (step.distanceM != null) return step.distanceM;
  const secPerKm = step.range ? rangeMiddle(step.range) : stepSecPerKm(step, null);
  return ((step.durationS ?? 0) / secPerKm) * 1000;
}

/** The run drawn as its shape; `scaleKm` sizes several runs against each other. */
export function RunShape({
  run,
  height = 48,
  scaleKm,
  className,
}: {
  run: Pick<PlannedRun, "blocks" | "distanceKm">;
  height?: number;
  scaleKm?: number;
  className?: string;
}) {
  const segments = run.blocks.flatMap((block) =>
    Array.from({ length: block.repeat }, () => block.steps).flat(),
  );
  const width = scaleKm ? Math.min(100, (run.distanceKm / scaleKm) * 100) : 100;
  return (
    <div
      aria-hidden
      className={cn("flex items-end gap-px", className)}
      style={{ height, width: `${width}%` }}
    >
      {segments.map((step, index) => {
        const level = LEVEL_STYLE[effortLevel(step)];
        return (
          <i
            key={index}
            className={cn("block min-w-px rounded-t-[2px]", level.bg)}
            style={{ flex: stepMetres(step), height: level.height }}
          />
        );
      })}
    </div>
  );
}

export const rangeText = (range: PaceRange) =>
  `${formatPaceClock(range.fastSecPerKm)}–${formatPaceClock(range.slowSecPerKm)}/km`;

const PART_LABEL = { warmup: "Warm-up", cooldown: "Cool-down" } as const;

/** "800 m at 4:15–4:20/km", "400 m jog", "Warm-up: 2 km easy". */
export function stepText(step: PlannedStep) {
  const part =
    step.part in PART_LABEL ? `${PART_LABEL[step.part as keyof typeof PART_LABEL]}: ` : "";
  const amount = stepAmountText(step);
  if (step.range) return `${part}${amount} at ${rangeText(step.range)}`;
  if (step.part === "recovery" && (step.effort === "easy" || step.pace === "easy")) {
    return `${part}${amount} jog`;
  }
  const label = step.pace
    ? `${PACE_TYPES.find((pace) => pace.id === step.pace)!.label.toLowerCase()} pace`
    : (EFFORTS.find((effort) => effort.id === step.effort)?.label ?? "easy");
  return `${part}${amount} ${label}`;
}

/** The pace range the run is about: its hardest stretch with a range. */
export function headlinePace(run: Pick<PlannedRun, "blocks">): PaceRange | null {
  const steps = run.blocks.flatMap((block) => block.steps).filter((step) => step.range);
  return steps.sort((a, b) => effortLevel(b) - effortLevel(a))[0]?.range ?? null;
}

/** The steps, a repeated block as one line: "6 × 800 m at 4:15–4:20/km, 400 m jog". */
export function RunSteps({ run }: { run: Pick<PlannedRun, "blocks"> }) {
  return (
    <ol className="flex flex-col">
      {run.blocks.map((block, index) => (
        <li key={index} className="flex gap-3 border-t py-2.5 first:border-t-0 first:pt-0">
          <span
            aria-hidden
            className={cn(
              "w-1 shrink-0 self-stretch rounded-full",
              LEVEL_STYLE[Math.max(...block.steps.map(effortLevel)) as Level].bg,
            )}
          />
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            {block.repeat > 1 ? (
              <span className="font-medium">
                {block.repeat} × {block.steps.map(stepText).join(", ")}
              </span>
            ) : (
              block.steps.map((step, stepIndex) => (
                <span key={stepIndex} className="font-medium">
                  {stepText(step)}
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
  run: PlannedRun;
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
        className="min-h-11 sm:min-h-9"
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
