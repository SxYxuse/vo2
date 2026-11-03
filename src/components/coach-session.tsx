"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";

import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { minutesText, sessionKindLabel } from "@/services/coach-plan.types.ts";
import { mondayOf } from "@/services/season-phase.ts";
import {
  DoneToggle,
  RunShape,
  RunSteps,
  SPORT_ICON,
  headlineTarget,
  weekLabel,
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

/** The session page of a coach-plan run or ride: its shape, steps, why, and whether it's done. */
export function CoachSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const navigate = useNavigate();
  const { data: state } = useSuspenseQuery(coachPlanQueryOptions);
  const run = state.plan?.weeks.flatMap((week) => week.sessions).find((s) => s.id === sessionId);

  if (!run) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Session not found</EmptyTitle>
          <EmptyDescription>
            This session is no longer in your coach plan. Pick one from Plan.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/week" />} nativeButton={false}>
            Plan
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const target = headlineTarget(run);
  const ride = run.sport === "ride";
  const { icon: Icon, className: iconClass } = SPORT_ICON[run.sport];
  const ahead = run.weekStart > mondayOf(state.today);

  return (
    <div className="flex flex-col gap-3 sm:gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          // Opened from the plan: go back to it, as it was, so the back gesture on Plan
          // leaves rather than returning here. Opened from a link or reloaded: replace this page.
          onClick={() => {
            if (router.state.location.state.planSessionPushed) router.history.back();
            else void navigate({ to: "/week", search: { week: run.weekStart }, replace: true });
          }}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Plan
        </Button>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <Icon aria-label={ride ? "Ride" : "Run"} className={cn("size-5", iconClass)} />
          {run.title}
          {run.done ? <Badge variant="success">Done</Badge> : null}
        </h1>
        <p className="text-muted-foreground text-sm">
          {sessionKindLabel(run.kind, run.sport)} · {weekLabel(run.weekStart, state.today)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-3">
        {ride ? null : (
          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs">Distance</dt>
            <dd className="text-xl font-semibold">{run.distanceKm} km</dd>
          </div>
        )}
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-xs">{ride ? "Time" : "Estimated time"}</dt>
          <dd className="text-xl font-semibold">{minutesText(run.minutes)}</dd>
        </div>
        <div className={cn("flex flex-col", !ride && "col-span-2 sm:col-span-1")}>
          <dt className="text-muted-foreground text-xs">{ride ? "Target" : "Pace"}</dt>
          <dd className="text-xl font-semibold">{target ?? "By feel"}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Shape</CardTitle>
            <CardDescription>
              Width is {ride ? "time" : "distance"}, height and colour are effort.
            </CardDescription>
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
              <CardTitle>Done?</CardTitle>
              <CardDescription>
                {ahead
                  ? "You can mark it done from its week on."
                  : "Do it on a day that suits you, then mark it done."}
              </CardDescription>
            </CardHeader>
            {ahead ? null : (
              <CardContent>
                <DoneToggle run={run} state={state} />
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
