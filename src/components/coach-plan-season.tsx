"use client";

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";

import {
  amountText,
  minutesText,
  planSportOf,
  progressionLabel,
  type CoachPlanState,
  type PlanWeek,
  type SeasonVolume,
  type SportVolume,
} from "@/services/coach-plan.types.ts";
import { PHASES, mondayOf, type SeasonWeek } from "@/services/season-phase.ts";
import { seasonEvents, type SeasonEvent } from "@/services/season.types.ts";
import { weekLabel } from "@/components/coach-run.tsx";
import { Dot, PhaseBadge } from "@/components/season-badges.tsx";
import { LEGEND_PHASES, PHASE_FILL, PRIORITY_FILL } from "@/components/season-style.ts";
import {
  ceilingFor,
  projectedAmounts,
  SPORT_VOLUME_LABEL,
  VolumeChart,
  writtenAmount,
} from "@/components/season-volume.tsx";

/*
 * The coach plan against the season, beside the week on Plan: each planned sport's weekly volume
 * through the last goal (ADR 0058: bars sized by the budget, coloured by phase, the written weeks
 * outlined, goals marked by priority), and the four written weeks with what each holds.
 */

/** "17 km running · 5 h 20 riding", leaving out a sport the week doesn't hold. */
export function weekTotals(week: PlanWeek) {
  const runs = week.sessions.filter((session) => session.sport === "run");
  const rides = week.sessions.filter((session) => session.sport === "ride");
  const km = Math.round(runs.reduce((sum, run) => sum + run.distanceKm, 0));
  const minutes = rides.reduce((sum, ride) => sum + ride.minutes, 0);
  return [
    runs.length ? `${km} km running` : null,
    rides.length ? `${minutesText(Math.round(minutes / 5) * 5)} riding` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Base now, build from 3 Aug, peak from 7 Sep, taper from 21 Sep." */
export function phaseText(road: SeasonWeek[]) {
  const parts: string[] = [];
  road.forEach((week, index) => {
    if (index > 0 && road[index - 1]!.phase === week.phase) return;
    const label = PHASES[week.phase].label;
    parts.push(
      index === 0
        ? `${label} now`
        : `${label.toLowerCase()} from ${format(parseISO(week.weekStart), "d MMM")}`,
    );
  });
  return parts.length ? `${parts.join(", ")}.` : "";
}

/** The four written weeks: what each holds, and a tap shows it. */
function WrittenWeeks({
  weeks,
  state,
  shown,
  onShow,
}: {
  weeks: PlanWeek[];
  state: CoachPlanState;
  shown: string | undefined;
  onShow: (weekStart: string) => void;
}) {
  return (
    <ol
      className="bg-card ring-foreground/10 flex flex-col overflow-hidden rounded-lg ring-1"
      aria-label="Written weeks"
    >
      {weeks.map((week) => {
        const goals = state.goals.filter((goal) => mondayOf(goal.date) === week.weekStart);
        const current = week.weekStart === shown;
        return (
          <li key={week.weekStart} className="border-foreground/10 border-t first:border-t-0">
            <button
              type="button"
              aria-current={current ? "true" : undefined}
              onClick={() => onShow(week.weekStart)}
              className={cn(
                "hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-start max-sm:min-h-11",
                current && "bg-muted",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <b className="font-medium">{weekLabel(week.weekStart, state.today)}</b>
                  <PhaseBadge kind={week.phase} lighter={week.lighter} />
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {weekTotals(week) || "No sessions"}
                </span>
                {goals.map((goal) => (
                  <span key={goal.id} className="flex items-center gap-1.5 text-xs">
                    <Dot fill={PRIORITY_FILL[goal.priority]} />
                    {goal.name}
                  </span>
                ))}
              </span>
              <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** " (36 % above recommended)" for an own peak above the one VO2 recommends (ADR 0058). */
function aboveText(sport: SportVolume) {
  if (sport.peak == null || sport.peak <= sport.recommended) return "";
  return ` (${Math.round((sport.peak / sport.recommended - 1) * 100)} % above recommended)`;
}

/**
 * Each planned sport's season as a chart, a tap showing that week's numbers, and the athlete's
 * progression with the way to change it (ADR 0058).
 */
function SeasonVolumeCharts({
  volume,
  state,
  weeks,
  events,
  onShow,
}: {
  volume: SeasonVolume;
  state: CoachPlanState;
  weeks: PlanWeek[];
  events: SeasonEvent[];
  onShow: (weekStart: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const written = new Set(weeks.map((week) => week.weekStart));
  const series = volume.sports.map((sport) => {
    const amounts = projectedAmounts(volume.shape, sport, sport).map(
      (amount, index) =>
        writtenAmount(
          weeks.find((week) => week.weekStart === volume.shape[index]!.weekStart),
          sport.sport,
        ) ?? amount,
    );
    return { sport, amounts };
  });
  const at = selected ? volume.shape.findIndex((week) => week.weekStart === selected) : -1;
  const week = at >= 0 ? volume.shape[at] : null;
  const aSport = state.aGoal ? planSportOf(state.aGoal.sportType) : null;
  const holding = volume.sports.find((sport) => sport.sport === aSport && sport.growth === 0);
  const phases = LEGEND_PHASES.filter((kind) => volume.shape.some((item) => item.phase === kind));
  return (
    <div className="flex flex-col gap-3">
      {series.map(({ sport, amounts }) => {
        const ceiling = ceilingFor(sport, sport);
        const under = sport.goal && ceiling < sport.goal.floor;
        return (
          <div key={sport.sport} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">
                {SPORT_VOLUME_LABEL[sport.sport].name}
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {SPORT_VOLUME_LABEL[sport.sport].unit}
                </span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                peak {amountText(sport.sport, Math.max(...amounts))}
              </span>
            </div>
            <VolumeChart
              sport={sport.sport}
              shape={volume.shape}
              amounts={amounts}
              written={written}
              doneThisWeek={sport.doneThisWeek}
              events={events}
              selected={selected}
              onSelect={(weekStart) => {
                setSelected(weekStart);
                if (written.has(weekStart)) onShow(weekStart);
              }}
            />
            {under ? (
              <p className="text-warning text-xs">
                Peak {amountText(sport.sport, ceiling)}, under the{" "}
                {amountText(sport.sport, sport.goal!.floor)} {sport.goal!.name} usually asks for.
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-hidden>
        {phases.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5">
            <Dot fill={PHASE_FILL[kind]} />
            {PHASES[kind].label}
          </span>
        ))}
      </div>
      <p
        className="bg-muted min-h-8 rounded-md px-2.5 py-2 text-xs tabular-nums"
        aria-live="polite"
      >
        {week ? (
          <>
            <b className="font-medium">{weekLabel(week.weekStart, state.today)}</b> ·{" "}
            {PHASES[week.phase].label}
            {week.lighter ? ", lighter" : ""}
            {series.map(({ sport, amounts }) => ` · ${amountText(sport.sport, amounts[at]!)}`)}
            {written.has(week.weekStart) ? " · written" : " · forecast, recalculated each Monday"}
          </>
        ) : (
          <span className="text-muted-foreground">Tap a week to see its volume.</span>
        )}
      </p>
      {holding && state.aGoal ? (
        <p className="text-warning text-xs">
          {SPORT_VOLUME_LABEL[holding.sport].name} is set to Hold, so it won't build toward{" "}
          {state.aGoal.name}.
        </p>
      ) : null}
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          Progression:{" "}
          {volume.sports
            .map(
              (sport) =>
                `${SPORT_VOLUME_LABEL[sport.sport].name.toLowerCase()} ${progressionLabel(
                  sport.growth ?? sport.defaultGrowth,
                )}${sport.peak != null ? `, your peak ${amountText(sport.sport, sport.peak)}${aboveText(sport)}` : ""}`,
            )
            .join(" · ")}
        </span>
        <Link
          to="/settings/$section"
          params={{ section: "training" }}
          className="text-primary underline-offset-4 hover:underline max-sm:py-2"
        >
          Change
        </Link>
      </p>
    </div>
  );
}

/** The plan against the season: each sport's volume and the written weeks. */
export function PlanSeason({
  state,
  weeks,
  shown,
  onShow,
}: {
  state: CoachPlanState;
  weeks: PlanWeek[];
  shown: string | undefined;
  onShow: (weekStart: string) => void;
}) {
  const events = seasonEvents(state.goals);
  return (
    <section
      aria-labelledby="plan-season"
      className="flex flex-col gap-3 border-t pt-4 lg:border-t-0 lg:pt-0"
    >
      <div className="flex flex-col gap-2">
        <h2 id="plan-season" className="text-sm font-medium">
          Your season
        </h2>
        {state.road.length ? (
          <>
            {state.volume ? (
              <SeasonVolumeCharts
                volume={state.volume}
                state={state}
                weeks={weeks}
                events={events}
                onShow={onShow}
              />
            ) : null}
            <p className="text-muted-foreground text-xs">{phaseText(state.road)}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            No goals ahead: the plan holds your fitness.
          </p>
        )}
      </div>
      {weeks.length ? (
        <WrittenWeeks weeks={weeks} state={state} shown={shown} onShow={onShow} />
      ) : null}
    </section>
  );
}
