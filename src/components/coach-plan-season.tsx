"use client";

import { format, parseISO } from "date-fns";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";

import { minutesText, type CoachPlanState, type PlanWeek } from "@/services/coach-plan.types.ts";
import { PHASES, mondayOf, type SeasonWeek } from "@/services/season-phase.ts";
import {
  daysBetween,
  eventPriority,
  seasonEvents,
  type SeasonEvent,
} from "@/services/season.types.ts";
import { weekLabel } from "@/components/coach-run.tsx";
import { Dot, PhaseBadge } from "@/components/season-badges.tsx";
import { LEGEND_PHASES, PHASE_FILL, PRIORITY_FILL } from "@/components/season-style.ts";

/*
 * The coach plan against the season, beside the week on Plan: the season week by week through
 * the last goal (phase colours, the written weeks raised, goals marked by priority), and the four
 * written weeks with what each holds. It replaces the Season page's map, which projected hours
 * the coach plan's budgets didn't keep.
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

/** The season's weeks as bars: colour is the phase, raised weeks are written, dots are goals. */
function SeasonStrip({
  road,
  events,
  written,
  shown,
}: {
  road: SeasonWeek[];
  events: SeasonEvent[];
  written: Set<string>;
  shown: string | undefined;
}) {
  const first = road[0]!.weekStart;
  const indexOf = (date: string) => Math.floor(daysBetween(first, date) / 7);
  const months = road
    .map((week, index) => ({ week, index }))
    .filter(
      ({ week, index }) =>
        index === 0 || week.weekStart.slice(0, 7) !== road[index - 1]!.weekStart.slice(0, 7),
    )
    // A month label is skipped when it would crowd the next one.
    .filter(({ index }, at, all) => (all[at + 1]?.index ?? Infinity) - index >= 3);
  const phases = LEGEND_PHASES.filter((kind) => road.some((week) => week.phase === kind));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3" aria-hidden>
        {events.map((event) => {
          const index = indexOf(event.date);
          if (index < 0 || index >= road.length) return null;
          return (
            <span
              key={event.date}
              className="absolute top-0.5 size-2 -translate-x-1/2 rounded-full"
              style={{
                left: `${((index + 0.5) / road.length) * 100}%`,
                background: PRIORITY_FILL[eventPriority(event)],
              }}
            />
          );
        })}
      </div>
      <div aria-hidden className="flex h-6 items-end gap-0.5">
        {road.map((week) => (
          <i
            key={week.weekStart}
            className={cn(
              "block min-w-0 flex-1 rounded-[2px]",
              written.has(week.weekStart) ? "h-6" : "h-3 opacity-60",
              week.lighter && "opacity-40",
              week.weekStart === shown && "outline-foreground outline-2 outline-offset-1",
            )}
            style={{ background: PHASE_FILL[week.phase] }}
          />
        ))}
      </div>
      <div className="text-muted-foreground relative h-4 text-[11px]" aria-hidden>
        {months.map(({ week, index }) => (
          <span
            key={week.weekStart}
            className="absolute top-0"
            style={{ left: `${(index / road.length) * 100}%` }}
          >
            {format(parseISO(week.weekStart), "MMM")}
          </span>
        ))}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-hidden>
        {phases.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5">
            <Dot fill={PHASE_FILL[kind]} />
            {PHASES[kind].label}
          </span>
        ))}
      </div>
    </div>
  );
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
        const done = week.sessions.filter((session) => session.done).length;
        const started = week.weekStart <= mondayOf(state.today);
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
                  {started && week.sessions.length
                    ? ` · ${done} of ${week.sessions.length} done`
                    : ""}
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

/** The plan against the season: the season strip and the written weeks. */
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
  const written = new Set(weeks.map((week) => week.weekStart));
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
            <SeasonStrip road={state.road} events={events} written={written} shown={shown} />
            <p className="text-muted-foreground text-xs">
              {phaseText(state.road)} The raised weeks are written.
            </p>
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
