"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { writeCoachPlanAgain } from "@/services/coach-plan.ts";
import {
  minutesText,
  PLAN_SPORTS,
  sessionKindLabel,
  type CoachPlanState,
  type PlanWeek,
  type PlannedSession,
} from "@/services/coach-plan.types.ts";
import { PHASES, mondayOf } from "@/services/season-phase.ts";
import { PlanSeason, weekTotals } from "@/components/coach-plan-season.tsx";
import { CoachPlanMissingAlert } from "@/components/coach-plan-setup.tsx";
import {
  DoneToggle,
  RunShape,
  SPORT_ICON,
  headlineTarget,
  weekLabel,
} from "@/components/coach-run.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/*
 * The Plan view for coach-plan athletes: the week shown with arrows to the other written weeks,
 * its runs, rides, and swims as one unordered list (ADR 0048: no day, no order), and the plan against the
 * season (coach-plan-season.tsx). On desktop the season sits beside the week.
 */

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
          <AlertDescription>The coach writes your next four weeks of sessions.</AlertDescription>
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

function SessionCard({ run, state }: { run: PlannedSession; state: CoachPlanState }) {
  const target = headlineTarget(run);
  const { icon: Icon, className: iconClass } = SPORT_ICON[run.sport];
  const ride = run.sport === "ride";
  return (
    <li
      className={cn(
        "bg-card ring-foreground/10 flex flex-col gap-2 rounded-lg p-3 ring-1",
        run.done && "bg-muted/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <Icon
              aria-label={PLAN_SPORTS.find((sport) => sport.id === run.sport)?.label}
              className={cn("size-3.5 shrink-0", iconClass)}
            />
            <span className="truncate">{run.title}</span>
          </h3>
          <p className="text-muted-foreground text-xs">
            {sessionKindLabel(run.kind, run.sport)}
            {ride ? "" : ` · about ${run.minutes} min`}
            {target ? ` · ${target}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xl leading-tight font-semibold tracking-tight tabular-nums">
          {ride ? (
            minutesText(run.minutes)
          ) : (
            <>
              {run.sport === "swim"
                ? Math.round(run.distanceKm * 1000).toLocaleString("en")
                : run.distanceKm}
              <small className="text-muted-foreground ms-1 text-xs font-medium">
                {run.sport === "swim" ? "m" : "km"}
              </small>
            </>
          )}
        </span>
      </div>
      <RunShape run={run} height={16} className={cn(run.done && "opacity-60")} />
      <div className="flex flex-wrap items-start gap-2">
        <DoneToggle run={run} state={state} className="flex-1 sm:flex-none" />
        <Button
          variant="ghost"
          className="flex-1 sm:flex-none"
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
    return <p className="text-muted-foreground text-xs">No sessions planned this week.</p>;
  }
  return (
    <section aria-label="The week's sessions" className="flex flex-col gap-3">
      {started ? (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {done} of {week.sessions.length} done.
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
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
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
          {week.lighter ? ", lighter" : ""} · {weekTotals(week)}
        </span>
      </h2>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next week"
        disabled={!canStepForward}
        onClick={() => onStep(1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

export function CoachPlanView({ week: shown }: { week?: string }) {
  const navigate = useNavigate();
  const { data: state } = useSuspenseQuery(coachPlanQueryOptions);
  const thisWeek = state.today ? mondayOf(state.today) : "";
  // A plan written late in the week, on a Sunday with no session left to place, starts this week
  // with none: that week is not shown, rather than read as an empty written week.
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-x-6">
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
                className="self-start px-0"
                nativeButton={false}
                render={<Link to="/week" search={{}} replace resetScroll={false} />}
              >
                <Undo2Icon data-icon="inline-start" />
                {home === thisWeek ? "Back to this week" : "Back to the first week"}
              </Button>
            ) : null}
            {/* Clipped for the swipe; a pixel of room keeps the cards' rings inside the clip. */}
            <div className="-m-px touch-pan-y overflow-hidden p-px">
              <div ref={swipe.ref} {...swipe.handlers}>
                <WeekSessions week={week} state={state} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:sticky lg:top-4">
              <PlanSeason
                state={state}
                weeks={weeks}
                shown={week.weekStart}
                onShow={(weekStart) => void show(weekStart)}
              />
              <Button
                variant="outline"
                className="w-full"
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
