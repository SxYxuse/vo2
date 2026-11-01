"use client";

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ArrowLeftIcon, FootprintsIcon, Link2Icon, Unlink2Icon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { linkCoachPlanRun } from "@/services/coach-plan.ts";
import { DONE_SHARE, sessionKindLabel, sessionStatus } from "@/services/coach-plan.types.ts";
import { mondayOf } from "@/services/season-phase.ts";
import { sportGroupFor } from "@/services/sport-groups.ts";
import {
  ActivityLine,
  PlannedVsActual,
  RunShape,
  RunSteps,
  headlinePace,
  longDayLabel,
  rangeText,
} from "@/components/coach-run.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

/** The session page of a coach-plan run: its shape, steps, why, and the run that did it. */
export function CoachSession({ sessionId }: { sessionId: string }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const { data: state } = useSuspenseQuery(coachPlanQueryOptions);
  const link = useMutation({
    mutationFn: (activityId: string | null) =>
      linkCoachPlanRun({ data: { sessionId, activityId } }),
    onSuccess: (next) => queryClient.setQueryData(coachPlanQueryOptions.queryKey, next),
  });
  const run = state.plan?.weeks.flatMap((week) => week.sessions).find((s) => s.id === sessionId);

  if (!run) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Session not found</EmptyTitle>
          <EmptyDescription>
            This run is no longer in your coach plan. Pick one from This week.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/week" />} nativeButton={false}>
            This week
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const status = sessionStatus(run, state.activities, state.today);
  const actual = state.activities.find((item) => item.sessionId === run.id);
  const weekStart = mondayOf(run.date);
  const linkable = state.activities.filter(
    (item) =>
      !item.sessionId &&
      mondayOf(item.date) === weekStart &&
      sportGroupFor(item.sportType)?.id === "running",
  );
  const pace = headlinePace(run);
  const busy = link.isPending;

  return (
    <div className="flex flex-col gap-3 sm:gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          // Replaces the session page, so the back gesture on This week leaves it rather than
          // returning here.
          render={<Link to="/week" search={{ day: run.date }} replace />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          This week
        </Button>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <FootprintsIcon aria-hidden className="text-ds-amber-700 size-5" />
          {run.title}
          {run.key ? <Badge variant="info">Key session</Badge> : null}
          {status === "done" ? <Badge variant="success">Done</Badge> : null}
          {status === "missed" ? <Badge variant="destructive">Missed</Badge> : null}
        </h1>
        <p className="text-muted-foreground text-sm">
          {sessionKindLabel(run.kind)} · {run.date === state.today ? "Today, " : ""}
          {longDayLabel(run.date)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-xs">Distance</dt>
          <dd className="text-xl font-semibold">{run.distanceKm} km</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-xs">Estimated time</dt>
          <dd className="text-xl font-semibold">{run.minutes} min</dd>
        </div>
        <div className="col-span-2 flex flex-col sm:col-span-1">
          <dt className="text-muted-foreground text-xs">Pace</dt>
          <dd className="text-xl font-semibold">{pace ? rangeText(pace) : "By feel"}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Shape</CardTitle>
            <CardDescription>Width is distance, height and colour are effort.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RunShape run={run} height={96} />
            <RunSteps run={run} />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3 sm:gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Why</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{run.why}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your run</CardTitle>
              <CardDescription>
                {actual
                  ? actual.manual
                    ? "Linked by you."
                    : `Matched: a run on the day covering at least ${Math.round(DONE_SHARE * 100)} % of the distance.`
                  : status === "missed"
                    ? "No run on the day covered this session."
                    : `Done once a run on ${format(parseISO(run.date), "EEEE")} covers ${Math.round(run.distanceKm * DONE_SHARE * 10) / 10} km.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {actual ? (
                <>
                  <ActivityLine activity={actual} />
                  <PlannedVsActual run={run} actual={actual} />
                  <Button
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    disabled={!online || busy}
                    onClick={() => link.mutate(null)}
                  >
                    {busy ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Unlink2Icon data-icon="inline-start" />
                    )}
                    Not this run
                  </Button>
                </>
              ) : run.date > state.today ? (
                <p className="text-muted-foreground text-sm">
                  A run can be linked from {format(parseISO(run.date), "EEEE")} on.
                </p>
              ) : linkable.length ? (
                <ul className="flex flex-col" aria-label="Link a run">
                  <li className="text-muted-foreground pb-1 text-xs">Link a run from this week</li>
                  {linkable.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 border-t py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <ActivityLine activity={item} />
                        <span className="text-muted-foreground ps-6 text-xs">
                          {format(parseISO(item.date), "EEE d MMM")}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 sm:min-h-8"
                        aria-label={`Link ${item.name} on ${format(parseISO(item.date), "EEE d MMM")}`}
                        disabled={!online || busy}
                        onClick={() => link.mutate(item.id)}
                      >
                        <Link2Icon data-icon="inline-start" />
                        Link
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No other run this week to link.</p>
              )}
              {!online ? (
                <p className="text-muted-foreground text-xs">Offline: runs can't be linked now.</p>
              ) : link.error ? (
                <p className="text-destructive text-xs">Could not save. Nothing was saved.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
