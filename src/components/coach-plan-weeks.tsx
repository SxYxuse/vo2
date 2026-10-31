"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CheckIcon, RotateCcwIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { writeCoachPlanAgain } from "@/services/coach-plan.ts";
import { sessionLines, type PlanWeek, type PlannedRun } from "@/services/coach-plan.types.ts";
import { PHASES, mondayOf } from "@/services/season-phase.ts";
import { CoachPlanMissingAlert } from "@/components/coach-plan-setup.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/*
 * A plain, read-only list of the four written weeks for coach-plan athletes. Temporary on purpose:
 * the Plan view (#138) replaces it with the day strip and session drawings.
 */

const dayLabel = (date: string) => format(parseISO(date), "EEE d MMM");

function SessionRow({ run, done }: { run: PlannedRun; done: boolean }) {
  return (
    <li className="flex flex-col gap-1 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-muted-foreground w-24 shrink-0 text-sm">{dayLabel(run.date)}</span>
        <span className="font-medium">{run.title}</span>
        {run.key ? <Badge variant="secondary">Key</Badge> : null}
        {done ? (
          <Badge variant="outline">
            <CheckIcon data-icon="inline-start" />
            Done
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">
        {run.distanceKm} km · about {run.minutes} min
      </p>
      <ul className="text-sm">
        {sessionLines(run).map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm italic">{run.why}</p>
    </li>
  );
}

function WeekCard({
  week,
  current,
  done,
}: {
  week: PlanWeek;
  current: boolean;
  done: Set<string>;
}) {
  const planned = Math.round(week.sessions.reduce((sum, run) => sum + run.distanceKm, 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {current ? "This week" : `Week of ${format(parseISO(week.weekStart), "d MMM")}`}
          <Badge variant="outline">{PHASES[week.phase].label}</Badge>
          {week.lighter ? <Badge variant="outline">Lighter</Badge> : null}
          {week.taper ? <Badge variant="outline">Taper</Badge> : null}
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          {planned} km planned of a {week.budgetKm} km budget
        </p>
      </CardHeader>
      <CardContent>
        {week.sessions.length ? (
          <ul>
            {week.sessions.map((run) => (
              <SessionRow key={run.id} run={run} done={done.has(run.id)} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No runs this week.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function CoachPlanWeeks() {
  const online = useOnline();
  const queryClient = useQueryClient();
  const { data: state } = useSuspenseQuery(coachPlanQueryOptions);
  const again = useMutation({
    mutationFn: () => writeCoachPlanAgain(),
    onSuccess: (next) => queryClient.setQueryData(coachPlanQueryOptions.queryKey, next),
  });
  const thisWeek = state.today ? mondayOf(state.today) : "";
  const weeks = (state.plan?.weeks ?? []).filter((week) => week.weekStart >= thisWeek).slice(0, 4);
  const done = new Set(state.done);
  const canWrite = online && !state.missing.length && state.status !== "writing";

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
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
      ) : null}
      {weeks.length ? (
        weeks.map((week) => (
          <WeekCard
            key={week.weekStart}
            week={week}
            current={week.weekStart === thisWeek}
            done={done}
          />
        ))
      ) : state.status === "idle" && !state.missing.length ? (
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
    </div>
  );
}
