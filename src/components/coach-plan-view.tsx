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
  sessionStatus,
  type CoachPlanState,
  type PlanActivity,
  type PlanWeek,
  type PlannedRun,
} from "@/services/coach-plan.types.ts";
import { addDayKey } from "@/services/day-key.ts";
import { PHASES, mondayOf, type PhaseKind } from "@/services/season-phase.ts";
import { daysBetween } from "@/services/season.types.ts";
import { canPredict, predictRaceSeconds } from "@/services/training-paces.types.ts";
import { CoachDayNote } from "@/components/coach-day-note.tsx";
import { CoachPlanMissingAlert } from "@/components/coach-plan-setup.tsx";
import {
  ActivityLine,
  PlannedVsActual,
  RunShape,
  RunSteps,
  headlinePace,
  longDayLabel,
  rangeText,
} from "@/components/coach-run.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/*
 * The Plan view for coach-plan athletes (#134, mockup A2): the week shown with arrows to the
 * other written weeks, a strip of its days, the selected day in full, and the road to the race.
 * On desktop the same pieces in two columns, the selected day on the right.
 */

const days = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDayKey(weekStart, i));
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

function chipBar(run: PlannedRun | undefined, status: string | null) {
  if (!run) return "bg-muted";
  if (status === "done") return "bg-success";
  if (status === "missed") return "bg-destructive";
  return run.key ? "bg-ds-amber-900" : "bg-ds-amber-500";
}

function DayStrip({
  week,
  state,
  selected,
  onSelect,
}: {
  week: PlanWeek;
  state: CoachPlanState;
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="group" aria-label="Days of the week">
      {days(week.weekStart).map((date) => {
        const run = week.sessions.find((session) => session.date === date);
        const status = run ? sessionStatus(run, state.activities, state.today) : null;
        const extras = state.activities.some((item) => item.date === date && !item.sessionId);
        const on = date === selected;
        const today = date === state.today;
        return (
          <button
            key={date}
            type="button"
            aria-pressed={on}
            aria-label={`${format(parseISO(date), "EEEE d MMMM")}${today ? ", today" : ""}: ${
              run
                ? `${run.title}, ${run.distanceKm} km${status === "planned" ? "" : `, ${status}`}`
                : "rest day"
            }`}
            onClick={() => onSelect(date)}
            className={cn(
              "flex min-h-16 min-w-0 flex-col items-center gap-0.5 rounded-xl border px-0.5 pt-1.5 pb-2 text-[11px] leading-tight transition-colors",
              on
                ? "bg-foreground text-background border-foreground"
                : today
                  ? "border-info text-info"
                  : "text-muted-foreground hover:bg-muted",
            )}
          >
            {format(parseISO(date), "EEE")}
            <b className={cn("text-[15px]", on ? "text-background" : "text-foreground")}>
              {format(parseISO(date), "d")}
            </b>
            <span className="tabular-nums">{run ? `${run.distanceKm} km` : "rest"}</span>
            <span className="flex items-center gap-0.5">
              <span className={cn("h-1 w-6 rounded-full", chipBar(run, status))} />
              {extras ? <span className="bg-muted-foreground size-1 rounded-full" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RunSummary({
  run,
  state,
  actual,
}: {
  run: PlannedRun;
  state: CoachPlanState;
  actual: PlanActivity | undefined;
}) {
  const pace = headlinePace(run);
  const status = sessionStatus(run, state.activities, state.today);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          {run.title}
          {run.key ? <Badge variant="info">Key</Badge> : null}
          {status === "done" ? <Badge variant="success">Done</Badge> : null}
          {status === "missed" ? <Badge variant="destructive">Missed</Badge> : null}
        </h2>
        <span className="shrink-0 text-3xl font-semibold tracking-tight tabular-nums">
          {run.distanceKm}
          <small className="text-muted-foreground ms-1 text-sm font-medium">km</small>
        </span>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">
        {sessionKindLabel(run.kind)} · about {run.minutes} min
        {pace ? ` · ${rangeText(pace)}` : ""}
      </p>
      <RunShape run={run} height={56} />
      <RunSteps run={run} />
      <p className="text-sm leading-relaxed">{run.why}</p>
      {actual ? <PlannedVsActual run={run} actual={actual} /> : null}
      {status === "missed" ? (
        <p className="text-muted-foreground text-sm">
          No run on this day covered {Math.round(run.distanceKm * 0.7 * 10) / 10} km. Link one on
          the session page if it was done.
        </p>
      ) : null}
      <Button
        className="min-h-11 w-full sm:w-auto sm:self-start"
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
        Open the full session
      </Button>
      {status !== "done" && run.kind !== "race" && run.date >= state.today ? (
        <CoachDayNote
          date={run.date}
          disabledReason={
            state.status === "writing"
              ? "Your plan is being written again: send a note once it's written."
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function DayDetail({
  date,
  state,
  weeks,
  onSelect,
}: {
  date: string;
  state: CoachPlanState;
  weeks: PlanWeek[];
  onSelect: (date: string) => void;
}) {
  const sessions = weeks.flatMap((week) => week.sessions);
  const run = sessions.find((session) => session.date === date);
  const onDay = state.activities.filter((item) => item.date === date);
  const extras = onDay.filter((item) => !item.sessionId);
  const actual = run ? onDay.find((item) => item.sessionId === run.id) : undefined;
  const next = run ? null : sessions.find((session) => session.date > date);
  return (
    <section aria-label="Selected day" className="flex flex-col gap-3">
      <p
        className={cn(
          "text-sm font-semibold",
          date === state.today ? "text-info" : "text-muted-foreground",
        )}
      >
        {date === state.today ? "Today, " : ""}
        {longDayLabel(date)}
      </p>
      {run ? (
        <RunSummary run={run} state={state} actual={actual} />
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            {extras.length ? "No run planned" : "Rest day"}
          </h2>
          {next ? (
            <Button
              variant="outline"
              className="min-h-11 justify-between sm:self-start"
              onClick={() => onSelect(next.date)}
            >
              Next run: {format(parseISO(next.date), "EEE d MMM")}, {next.title}
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ) : null}
        </div>
      )}
      {extras.length ? (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <p className="text-muted-foreground text-xs">
            {run ? "Also on this day" : "Done on this day"}
          </p>
          {extras.map((item) => (
            <ActivityLine key={item.id} activity={item} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WeekHeader({
  week,
  thisWeek,
  onStep,
  canStepBack,
  canStepForward,
}: {
  week: PlanWeek;
  thisWeek: string;
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
        <b className="font-medium">
          {week.weekStart === thisWeek
            ? "This week"
            : `Week of ${format(parseISO(week.weekStart), "d MMM")}`}
        </b>
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
    <section aria-labelledby="road" className="flex flex-col gap-2 border-t pt-4">
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

export function CoachPlanView({ day }: { day?: string }) {
  const navigate = useNavigate();
  const { data: state } = useSuspenseQuery(coachPlanQueryOptions);
  const thisWeek = state.today ? mondayOf(state.today) : "";
  // A plan written late in the week, on a Sunday without a run, starts this week with no day left
  // to place a run on: that week is not shown, rather than read as a written week of 0 km.
  const weeks = (state.plan?.weeks ?? [])
    .filter(
      (week) => week.weekStart > thisWeek || (week.weekStart === thisWeek && week.sessions.length),
    )
    .slice(0, 4);
  const inPlan = (date: string | undefined) =>
    date != null && weeks.some((week) => week.weekStart === mondayOf(date));
  // The week the view opens on: this week, or the first written one when the plan starts later (a
  // first plan written on a Sunday after a run starts on Monday). This week opens on today, any
  // other week on its first run.
  const home = weeks[0]?.weekStart ?? thisWeek;
  const openingDay = (target: PlanWeek) =>
    target.weekStart === thisWeek ? state.today : (target.sessions[0]?.date ?? target.weekStart);
  const selected = inPlan(day) ? day! : weeks[0] ? openingDay(weeks[0]) : state.today;
  const index = Math.max(
    0,
    weeks.findIndex((week) => week.weekStart === mondayOf(selected)),
  );
  const week = weeks[index];
  const select = (date: string) =>
    navigate({
      to: "/week",
      search: weeks[0] && date === openingDay(weeks[0]) ? {} : { day: date },
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
      if (target) await select(openingDay(target));
    },
  });

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PlanStatus state={state} />
      {week ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-x-8">
          <div className="flex flex-col gap-2 lg:col-start-1 lg:row-start-1">
            <WeekHeader
              week={week}
              thisWeek={thisWeek}
              canStepBack={canStepBack}
              canStepForward={canStepForward}
              onStep={(direction) => void swipe.slide(direction)}
            />
            <div className="touch-pan-y overflow-hidden">
              <div ref={swipe.ref} {...swipe.handlers}>
                <DayStrip week={week} state={state} selected={selected} onSelect={select} />
              </div>
            </div>
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
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="lg:sticky lg:top-4">
              <DayDetail date={selected} state={state} weeks={weeks} onSelect={select} />
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
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
      ) : null}
    </div>
  );
}
