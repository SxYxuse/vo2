"use client";

import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ChevronRightIcon, FlagIcon } from "lucide-react";
import { cn } from "cn";

import {
  formatDistanceKm,
  formatDuration,
  formatElevation,
} from "@/services/activity-detail.types.ts";
import {
  minutesText,
  planSportOf,
  sessionsPerWeek,
  type CoachPlanState,
  type PlanWeek,
} from "@/services/coach-plan.types.ts";
import { PHASES, mondayOf, type SeasonWeek } from "@/services/season-phase.ts";
import {
  daysBetween,
  eventPriority,
  eventTitle,
  legLabel,
  seasonEvents,
  type Goal,
  type SeasonEvent,
} from "@/services/season.types.ts";
import { sportGroupFor } from "@/services/sport-groups.ts";
import { canPredict, predictRaceSeconds } from "@/services/training-paces.types.ts";
import { weekLabel } from "@/components/coach-run.tsx";
import { Dot, PhaseBadge, PriorityBadge } from "@/components/season-badges.tsx";
import { LEGEND_PHASES, PHASE_FILL, PRIORITY_FILL } from "@/components/season-style.ts";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { Button } from "@/components/ui/button";

/*
 * The coach plan against the season, beside the week on Plan: the season week by week through
 * the last goal (phase colours, the written weeks raised, goals marked by priority), the four
 * written weeks with what each holds, and the goals ahead with what the plan does for each. It
 * replaces the Season page's map, which projected hours the coach plan's budgets didn't keep.
 */

/** How many goals ahead are listed; the rest are on Season. */
const GOALS_SHOWN = 5;

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

const weeksAway = (today: string, date: string) => {
  const weeks = Math.floor(daysBetween(mondayOf(today), date) / 7);
  return weeks <= 0 ? "this week" : `in ${weeks} week${weeks === 1 ? "" : "s"}`;
};

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
      <div aria-hidden className="flex h-8 items-end gap-0.5">
        {road.map((week) => (
          <i
            key={week.weekStart}
            className={cn(
              "block min-w-0 flex-1 rounded-[2px]",
              written.has(week.weekStart) ? "h-8" : "h-4 opacity-60",
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
    <ol className="flex flex-col" aria-label="Written weeks">
      {weeks.map((week) => {
        const goals = state.goals.filter((goal) => mondayOf(goal.date) === week.weekStart);
        const done = week.sessions.filter((session) => session.done).length;
        const started = week.weekStart <= mondayOf(state.today);
        const current = week.weekStart === shown;
        return (
          <li key={week.weekStart} className="border-t first:border-t-0">
            <button
              type="button"
              aria-current={current ? "true" : undefined}
              onClick={() => onShow(week.weekStart)}
              className={cn(
                "hover:bg-muted/50 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-start",
                current && "bg-muted",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
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

/** What the coach plan does for a goal, in words. */
function treatment(goal: Goal, state: CoachPlanState) {
  const sport = planSportOf(goal.sportType);
  if (!sport) return "Not planned: the coach plan writes runs and rides.";
  if (state.availability && sessionsPerWeek(state.availability, sport) === 0) {
    return `No ${sport === "ride" ? "rides" : "runs"} planned a week: add some in Settings.`;
  }
  if (goal.id === state.aGoal?.id) {
    const predicted =
      sport === "run" && state.vdot != null && goal.distanceM != null && canPredict(goal.distanceM)
        ? ` · ${formatDuration(predictRaceSeconds(state.vdot, goal.distanceM))} predicted`
        : "";
    return `The plan builds to it: build, peak, and taper${predicted}.`;
  }
  if (goal.priority === "A") return "The next build, once the A goal before it is done.";
  if (goal.priority === "B") return "Raced to finish well, with easy sessions before it.";
  return "Trained through, as that week's hard session.";
}

function GoalsAhead({ state }: { state: CoachPlanState }) {
  const events = seasonEvents(state.goals);
  if (!events.length) return null;
  const shown = events.slice(0, GOALS_SHOWN);
  return (
    <section aria-labelledby="goals-ahead" className="flex flex-col gap-2">
      <h3 id="goals-ahead" className="text-sm font-semibold">
        Goals ahead
      </h3>
      <ul className="flex flex-col gap-2">
        {shown.map((event) => (
          <li key={event.date} className="flex flex-col gap-1 rounded-lg border px-3 py-2">
            <div className="flex items-center gap-2">
              <PriorityBadge priority={eventPriority(event)} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {eventTitle(event)}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {format(parseISO(event.date), "d MMM")}, {weeksAway(state.today, event.date)}
              </span>
            </div>
            {event.goals.map((goal) => {
              const group = sportGroupFor(goal.sportType)?.id;
              const Icon = group ? SPORT_STYLE[group].icon : FlagIcon;
              const leg = legLabel(goal, event);
              const facts = [
                leg ?? (group ? SPORT_STYLE[group].label : goal.sportType),
                goal.distanceM != null ? formatDistanceKm(goal.distanceM) : null,
                goal.elevationGainM ? `${formatElevation(goal.elevationGainM)} D+` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={goal.id} className="flex items-start gap-2 text-xs">
                  <Icon
                    aria-label={group ? SPORT_STYLE[group].label : goal.sportType}
                    className={cn("mt-0.5 size-3.5 shrink-0", group ? SPORT_STYLE[group].text : "")}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="tabular-nums">{facts}</span>
                    <span className="text-muted-foreground">{treatment(goal, state)}</span>
                  </span>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      <Button
        variant="link"
        className="min-h-11 self-start px-0"
        nativeButton={false}
        render={<Link to="/season" />}
      >
        {events.length > GOALS_SHOWN
          ? `${events.length - GOALS_SHOWN} more in Season`
          : "Change goals in Season"}
      </Button>
    </section>
  );
}

/** The plan against the season: the season strip, the written weeks, and the goals ahead. */
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
      className="flex flex-col gap-4 border-t pt-4 lg:border-t-0 lg:pt-0"
    >
      <div className="flex flex-col gap-2">
        <h2 id="plan-season" className="font-semibold">
          Your season
        </h2>
        {state.road.length ? (
          <>
            <SeasonStrip road={state.road} events={events} written={written} shown={shown} />
            <p className="text-muted-foreground text-sm">
              {phaseText(state.road)} The raised weeks are written.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            No goals ahead: the plan holds your fitness.
          </p>
        )}
      </div>
      {weeks.length ? (
        <WrittenWeeks weeks={weeks} state={state} shown={shown} onShow={onShow} />
      ) : null}
      <GoalsAhead state={state} />
    </section>
  );
}
