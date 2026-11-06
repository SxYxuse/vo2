"use client";

import { format, parseISO } from "date-fns";
import { cn } from "cn";

import { projectSport, type WeekBudget, type WeekShape } from "@/services/coach-plan-budget.ts";
import {
  amountText,
  budgetOf,
  type PlanSport,
  type PlanWeek,
  type SeasonVolume,
  type SportVolume,
} from "@/services/coach-plan.types.ts";
import { daysBetween, eventPriority, type SeasonEvent } from "@/services/season.types.ts";
import { PHASE_FILL, PRIORITY_FILL } from "@/components/season-style.ts";

/*
 * A plan sport's weekly volume through the season (ADR 0058): one bar a week, its height the
 * budget, its colour the phase. Plan shows it read-only; Settings → Training redraws it live as
 * the athlete moves the progression. Both project with the same code the coach is held to.
 */

export const SPORT_VOLUME_LABEL: Record<PlanSport, { name: string; unit: string }> = {
  run: { name: "Running", unit: "km per week" },
  ride: { name: "Riding", unit: "hours per week" },
  swim: { name: "Swimming", unit: "metres per week" },
};

/** The athlete's choice for a sport: growth (null is the default by week) and own peak. */
export type SportChoice = { growth: number | null; peak: number | null };

export const ceilingFor = (sport: SportVolume, choice: SportChoice) =>
  choice.peak ?? sport.recommended;

/** The sport's amount each week of the season, at a progression and peak. */
export function projectedAmounts(
  shape: WeekShape[],
  sport: SportVolume,
  choice: SportChoice,
): number[] {
  return projectSport(shape, sport.seed, sport.sport, choice.growth, ceilingFor(sport, choice));
}

/** The season's budgets at the athlete's choices, as the plan check reads them. */
export function projectedBudgets(
  volume: SeasonVolume,
  choices: Partial<Record<PlanSport, SportChoice>>,
): WeekBudget[] {
  const amounts = (sport: PlanSport) => {
    const found = volume.sports.find((item) => item.sport === sport);
    const choice = choices[sport] ?? { growth: found?.growth ?? null, peak: found?.peak ?? null };
    return found ? projectedAmounts(volume.shape, found, choice) : null;
  };
  const run = amounts("run");
  const ride = amounts("ride");
  const swim = amounts("swim");
  return volume.shape.map((week, index) => ({
    weekStart: week.weekStart,
    budgetKm: run?.[index] ?? 0,
    budgetMinutes: ride?.[index] ?? 0,
    budgetSwimM: swim?.[index] ?? 0,
    phase: week.phase,
    lighter: week.lighter,
    taper: week.taper,
  }));
}

/** The first week at the ceiling's level, when the season reaches it. */
export function weekReaching(shape: WeekShape[], amounts: number[], ceiling: number) {
  const index = amounts.findIndex(
    (amount, at) => shape[at]!.share === 1 && amount >= ceiling - Math.max(1, ceiling * 0.01),
  );
  return index < 0 ? null : shape[index]!.weekStart;
}

/** A written week's budget for a sport, where the plan has one. */
export function writtenAmount(week: PlanWeek | undefined, sport: PlanSport) {
  if (!week) return null;
  return budgetOf(week, sport);
}

type Line = { value: number; label: string; tone: "muted" | "warning" };

export function VolumeChart({
  sport,
  shape,
  amounts,
  written,
  doneThisWeek,
  events,
  lines = [],
  selected,
  onSelect,
}: {
  sport: PlanSport;
  shape: WeekShape[];
  amounts: number[];
  /** Weeks the coach wrote: outlined. */
  written: Set<string>;
  /** What's done of the sport this week: the first bar fills to it. */
  doneThisWeek?: number;
  events: SeasonEvent[];
  lines?: Line[];
  selected?: string;
  onSelect?: (weekStart: string) => void;
}) {
  const first = shape[0]?.weekStart;
  if (!first) return null;
  const top = Math.max(1, ...amounts, ...lines.map((line) => line.value)) * 1.08;
  const indexOf = (date: string) => Math.floor(daysBetween(first, date) / 7);
  const months = shape
    .map((week, index) => ({ week, index }))
    .filter(
      ({ week, index }) =>
        index === 0 || week.weekStart.slice(0, 7) !== shape[index - 1]!.weekStart.slice(0, 7),
    )
    // A month label is skipped when it would crowd the next one.
    .filter(({ index }, at, all) => (all[at + 1]?.index ?? Infinity) - index >= 3);
  const Bar = onSelect ? "button" : "span";
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-2.5" aria-hidden>
        {events.map((event) => {
          const index = indexOf(event.date);
          if (index < 0 || index >= shape.length) return null;
          return (
            <span
              key={event.date}
              className="absolute top-0 size-2 -translate-x-1/2 rounded-full"
              style={{
                left: `${((index + 0.5) / shape.length) * 100}%`,
                background: PRIORITY_FILL[eventPriority(event)],
              }}
            />
          );
        })}
      </div>
      <div className="relative flex h-20 items-end gap-0.5">
        {lines.map((line) => (
          <span
            key={line.label}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 border-t text-[10px] leading-none",
              line.tone === "warning"
                ? "border-warning text-warning"
                : "border-muted-foreground/60 text-muted-foreground border-dashed",
            )}
            style={{ bottom: `${(line.value / top) * 100}%` }}
          >
            <span
              className={cn(
                "bg-background/80 absolute -top-3 px-0.5",
                line.tone === "warning" ? "right-0" : "left-0",
              )}
            >
              {line.label}
            </span>
          </span>
        ))}
        {shape.map((week, index) => {
          const amount = amounts[index] ?? 0;
          const current = index === 0 && doneThisWeek != null;
          const done = current && amount > 0 ? Math.min(1, doneThisWeek / amount) : 0;
          const isWritten = written.has(week.weekStart);
          return (
            <Bar
              key={week.weekStart}
              {...(onSelect
                ? { type: "button" as const, onClick: () => onSelect(week.weekStart) }
                : {})}
              aria-label={`${format(parseISO(week.weekStart), "d MMM")}: ${amountText(sport, amount)}`}
              aria-pressed={onSelect ? week.weekStart === selected : undefined}
              className={cn(
                "relative block min-w-0 flex-1 overflow-hidden rounded-[2px]",
                isWritten && !current && "ring-foreground/50 ring-1 ring-inset",
                week.weekStart === selected && "outline-foreground outline-2 outline-offset-1",
              )}
              style={{
                height: `${Math.max(2, (amount / top) * 100)}%`,
                background: current ? "transparent" : PHASE_FILL[week.phase],
                boxShadow: current ? `inset 0 0 0 1.5px ${PHASE_FILL[week.phase]}` : undefined,
                opacity: week.lighter ? 0.45 : isWritten || current ? 1 : 0.7,
              }}
            >
              {current ? (
                <span
                  className="absolute inset-x-0 bottom-0"
                  style={{ height: `${done * 100}%`, background: PHASE_FILL[week.phase] }}
                />
              ) : null}
            </Bar>
          );
        })}
      </div>
      <div className="text-muted-foreground relative h-4 text-[11px]" aria-hidden>
        {months.map(({ week, index }) => (
          <span
            key={week.weekStart}
            className="absolute top-0"
            style={{ left: `${(index / shape.length) * 100}%` }}
          >
            {format(parseISO(week.weekStart), "MMM")}
          </span>
        ))}
      </div>
    </div>
  );
}
