"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  SparklesIcon,
  Undo2Icon,
} from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { useWeekSwipe } from "@/hooks/use-week-swipe.ts";
import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { writeCoachPlanAgain } from "@/services/coach-plan.ts";
import {
  sessionKindLabel,
  type CoachPlanState,
  type PlanWeek,
  type PlannedRun,
} from "@/services/coach-plan.types.ts";
import { PHASES, mondayOf, type PhaseKind } from "@/services/season-phase.ts";
import { daysBetween } from "@/services/season.types.ts";
import { canPredict, predictRaceSeconds } from "@/services/training-paces.types.ts";
import { CoachWeekNote } from "@/components/coach-week-note.tsx";
import { CoachPlanMissingAlert } from "@/components/coach-plan-setup.tsx";
import {
  DoneToggle,
  RunShape,
  headlinePace,
  rangeText,
  weekLabel,
} from "@/components/coach-run.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/*
 * The Plan view for coach-plan athletes: the week shown with arrows to the other written weeks,
 * its sessions as one unordered list (ADR 0048: no day, no order), and the road to the race. On
 * desktop the road sits beside the week.
 */

const weekKm = (week: PlanWeek) =>
  Math.round(week.sessions.reduce((sum, run) => sum + run.distanceKm, 0));

function PlanStatus({ state }: { state: CoachPlanState }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const again = useMutation({
    mutationFn: () => writeCoachPlanAgain(),
    onSuccess: (next) => queryClient.setQueryData(coachPlanQueryOptions.queryKey, next),
  });
  const canWrite = online && !state.missing.length && state.status !== "writing";
  return (
    <>
      <CoachPlanMissingAlert missing={state.missing} />
      {state.status === "writing" ? (
        <Alert>
          <Spinner />
          <AlertTitle>Writing your plan…</AlertTitle>
          <AlertDescription>
            The coach writes on the server, so you can close the app. It shows here when it's ready.
          </AlertDescription>
        </Alert>
      ) : state.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>Plan writing failed</AlertTitle>
          <AlertDescription className="whitespace-pre-line">
            {state.error}
            {state.plan ? "\nThe plan below stays until a new one passes." : null}
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canWrite || again.isPending}
              onClick={() => again.mutate()}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : !state.plan && !state.missing.length ? (
        <Alert>
          <AlertTitle>No plan written yet</AlertTitle>
          <AlertDescription>The coach writes your next four weeks of runs.</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="sm"
              disabled={!canWrite || again.isPending}
              onClick={() => again.mutate()}
            >
              Write my plan
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
    </>
  );
}

function SessionCard({ run, state }: { run: PlannedRun; state: CoachPlanState }) {
  const pace = headlinePace(run);
  return (
    <li
      className={cn("flex flex-col gap-3 rounded-xl border p-3 sm:p-4", run.done && "bg-muted/50")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 font-semibold tracking-tight">{run.title}</h3>
        <span className="shrink-0 text-2xl font-semibold tracking-tight tabular-nums">
          {run.distanceKm}
          <small className="text-muted-foreground ms-1 text-sm font-medium">km</small>
        </span>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">
        {sessionKindLabel(run.kind)} · about {run.minutes} min
        {pace ? ` · ${rangeText(pace)}` : ""}
      </p>
      <RunShape run={run} height={40} className={cn(run.done && "opacity-60")} />
      <div className="flex flex-wrap items-start gap-2">
        <DoneToggle run={run} state={state} className="flex-1 sm:flex-none" />
        <Button
          variant="ghost"
          className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
          nativeButton={false}
          // Marked, so the session's "Plan" button goes back here rather than adding an entry.
          render={
            <Link
              to="/week/run/$sessionId"
              params={{ sessionId: run.id }}
              state={(prev) => ({ ...prev, planSessionPushed: true })}
            />
          }
        >
          Open the session
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </li>
  );
}

function WeekSessions({ week, state }: { week: PlanWeek; state: CoachPlanState }) {
  const done = week.sessions.filter((run) => run.done).length;
  const started = week.weekStart <= mondayOf(state.today);
  if (!week.sessions.length) {
    return <p className="text-muted-foreground text-sm">No runs planned this week.</p>;
  }
  return (
    <section aria-label="The week's sessions" className="flex flex-col gap-3">
      {started ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {done} of {week.sessions.length} done. Run them on the days that suit you.
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {week.sessions.map((run) => (
          <SessionCard key={run.id} run={run} state={state} />
        ))}
      </ul>
    </section>
  );
}

function WeekHeader({
  week,
  today,
  onStep,
  canStepBack,
  canStepForward,
}: {
  week: PlanWeek;
  today: string;
  onStep: (direction: 1 | -1) => void;
  canStepBack: boolean;
  canStepForward: boolean;
}) {
  const arrow = "size-[2.75rem] shrink-0 [&_svg]:size-5";
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={arrow}
        aria-label="Previous week"
        disabled={!canStepBack}
        onClick={() => onStep(-1)}
      >
        <ChevronLeftIcon />
      </Button>
      <h2 aria-live="polite" className="min-w-0 flex-1 text-center text-sm text-balance">
        <b className="font-medium">{weekLabel(week.weekStart, today)}</b>
        <span className="text-muted-foreground">
          {" "}
          · {PHASES[week.phase].label}
          {week.lighter ? ", lighter" : ""} · {weekKm(week)} km
        </span>
      </h2>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={arrow}
        aria-label="Next week"
        disabled={!canStepForward}
        onClick={() => onStep(1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

const PHASE_COLOR: Partial<Record<PhaseKind, string>> = {
  base: "bg-ds-amber-500",
  build: "bg-ds-amber-700",
  peak: "bg-ds-amber-900",
  taper: "bg-info",
  race: "bg-info",
};

/** "Base now, build from 3 Aug, peak from 7 Sep, taper from 21 Sep." */
function phaseText(road: CoachPlanState["road"]) {
  const parts: string[] = [];
  road.forEach((week, index) => {
    if (index > 0 && road[index - 1].phase === week.phase) return;
    const label = PHASES[week.phase].label;
    parts.push(
      index === 0
        ? `${label} now`
        : `${label.toLowerCase()} from ${format(parseISO(week.weekStart), "d MMM")}`,
    );
  });
  return `${parts.join(", ")}.`;
}

function RoadToRace({ state, weeks }: { state: CoachPlanState; weeks: PlanWeek[] }) {
  const goal = state.aGoal;
  if (!goal) return null;
  const weeksLeft = Math.max(0, Math.floor(daysBetween(mondayOf(state.today), goal.date) / 7));
  const written = new Set(weeks.map((week) => week.weekStart));
  const predicted =
    state.vdot != null && goal.distanceM != null && canPredict(goal.distanceM)
      ? formatDuration(predictRaceSeconds(state.vdot, goal.distanceM))
      : null;
  return (
    <section
      aria-labelledby="road"
      className="flex flex-col gap-2 border-t pt-4 lg:border-t-0 lg:pt-0"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="road" className="font-semibold">
          {goal.name}
        </h2>
        <span className="text-muted-foreground text-sm">
          {format(parseISO(goal.date), "d MMM")},{" "}
          {weeksLeft === 0 ? "this week" : `in ${weeksLeft} week${weeksLeft === 1 ? "" : "s"}`}
        </span>
      </div>
      {state.road.length ? (
        <>
          <div aria-hidden className="flex h-5 items-end gap-0.5">
            {state.road.map((week, index) => (
              <i
                key={week.weekStart}
                className={cn(
                  "block flex-1 rounded-[2px]",
                  PHASE_COLOR[week.phase] ?? "bg-muted-foreground",
                  written.has(week.weekStart) ? "h-5" : "h-3.5 opacity-50",
                  index === 0 && "outline-info outline-2 outline-offset-1",
                )}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            {phaseText(state.road)} The raised weeks are written.
          </p>
        </>
      ) : null}
      <p className="flex flex-wrap items-baseline gap-x-2">
        {predicted ? (
          <>
            <span className="text-xl font-semibold tracking-tight tabular-nums">{predicted}</span>
            <span className="text-muted-foreground text-sm">predicted today</span>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">
            No predicted time yet: it needs recent runs or a race result.
          </span>
        )}
      </p>
    </section>
  );
}

export function CoachPlanView({ week: shown }: { week?: string }) {
  const navigate = useNavigate();
  const { data: state } = useSuspenseQuery(coachPlanQueryOptions);
  const thisWeek = state.today ? mondayOf(state.today) : "";
  // A plan written late in the week, on a Sunday with no run left to place, starts this week with
  // no runs: that week is not shown, rather than read as a written week of 0 km.
  const weeks = (state.plan?.weeks ?? [])
    .filter(
      (week) => week.weekStart > thisWeek || (week.weekStart === thisWeek && week.sessions.length),
    )
    .slice(0, 4);
  // The week the view opens on: this week, or the first written one when the plan starts later.
  const home = weeks[0]?.weekStart ?? thisWeek;
  const index = Math.max(
    0,
    weeks.findIndex((week) => week.weekStart === shown),
  );
  const week = weeks[index];
  const show = (weekStart: string) =>
    navigate({
      to: "/week",
      search: weekStart === home ? {} : { week: weekStart },
      replace: true,
      resetScroll: false,
    });
  const canStepBack = index > 0;
  const canStepForward = index < weeks.length - 1;
  const swipe = useWeekSwipe({
    canStepForward,
    canStepBack,
    onStep: async (direction) => {
      const target = weeks[index + direction];
      if (target) await show(target.weekStart);
    },
  });

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PlanStatus state={state} />
      {week ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-8">
          <div className="flex min-w-0 flex-col gap-3">
            <WeekHeader
              week={week}
              today={state.today}
              canStepBack={canStepBack}
              canStepForward={canStepForward}
              onStep={(direction) => void swipe.slide(direction)}
            />
            {week.weekStart !== home ? (
              <Button
                variant="link"
                className="min-h-11 self-start px-0"
                nativeButton={false}
                render={<Link to="/week" search={{}} replace resetScroll={false} />}
              >
                <Undo2Icon data-icon="inline-start" />
                {home === thisWeek ? "Back to this week" : "Back to the first week"}
              </Button>
            ) : null}
            <div className="touch-pan-y overflow-hidden">
              <div ref={swipe.ref} {...swipe.handlers}>
                <WeekSessions week={week} state={state} />
              </div>
            </div>
            {week.sessions.some((run) => !run.done && run.kind !== "race") ? (
              <CoachWeekNote
                weekStart={week.weekStart}
                title={weekLabel(week.weekStart, state.today)}
                disabledReason={
                  state.status === "writing"
                    ? "Your plan is being written again: send a note once it's written."
                    : undefined
                }
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:sticky lg:top-4">
              <RoadToRace state={state} weeks={weeks} />
              <Button
                variant="outline"
                className="min-h-11 w-full"
                nativeButton={false}
                render={<Link to="/coach" search={{ change: true }} />}
              >
                <SparklesIcon data-icon="inline-start" />
                Ask the coach to change my plan
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
