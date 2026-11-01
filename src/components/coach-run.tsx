import { format, parseISO } from "date-fns";

import { cn } from "@/lib/utils";
import { formatPaceClock } from "@/services/locomotion.ts";
import {
  EFFORTS,
  stepAmountText,
  stepSecPerKm,
  type PlanActivity,
  type PlannedRun,
  type PlannedStep,
} from "@/services/coach-plan.types.ts";
import { PACE_TYPES, type PaceRange } from "@/services/training-paces.types.ts";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { sportGroupFor } from "@/services/sport-groups.ts";
import { formatDuration } from "@/services/activity-detail.types.ts";

/*
 * Pieces of a coach-plan run shared by the Plan view and the session page: its shape (width is
 * distance, height and amber depth are effort), its steps with repeats, and planned vs actual.
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

export const paceOf = (activity: Pick<PlanActivity, "km" | "seconds">) =>
  activity.km > 0 ? `${formatPaceClock(activity.seconds / activity.km)}/km` : "—";

/** Planned against what the run that did it shows: distance and average pace. */
export function PlannedVsActual({ run, actual }: { run: PlannedRun; actual: PlanActivity }) {
  // The plan's average is its time over its distance, steps and recoveries together.
  const rows = [
    { label: "Distance", planned: `${run.distanceKm} km`, actual: `${actual.km.toFixed(1)} km` },
    {
      label: "Average pace",
      planned: paceOf({ km: run.distanceKm, seconds: run.minutes * 60 }),
      actual: paceOf(actual),
    },
  ];
  return (
    <table className="w-full text-sm tabular-nums">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th className="py-1 text-start font-normal">
            <span className="sr-only">Measure</span>
          </th>
          <th className="py-1 text-end font-normal">Planned</th>
          <th className="py-1 text-end font-normal">Actual</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t">
            <th scope="row" className="py-1.5 text-start font-normal">
              {row.label}
            </th>
            <td className="py-1.5 text-end">{row.planned}</td>
            <td className="py-1.5 text-end font-medium">{row.actual}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** An activity on a day: a run that did no session, a ride, a swim. */
export function ActivityLine({ activity }: { activity: PlanActivity }) {
  const style = SPORT_STYLE[sportGroupFor(activity.sportType)?.id ?? "other"];
  const Icon = style.icon;
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <Icon aria-hidden className={cn("size-4 shrink-0", style.text)} />
      <span className="truncate">{activity.name}</span>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {activity.km > 0 ? `${activity.km.toFixed(1)} km · ` : ""}
        {formatDuration(activity.seconds)}
      </span>
    </span>
  );
}

export const longDayLabel = (date: string) => format(parseISO(date), "EEEE d MMMM");
