import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { Settings2Icon, TargetIcon } from "lucide-react";

import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { WeekView, WeekViewSkeleton, WeeksAhead } from "@/components/week-view.tsx";
import {
  appShellQueryOptions,
  isPlanningOff,
  loaderQuery,
  weekCoachQueryOptions,
  weekTargetQueryOptions,
} from "@/lib/queries.ts";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { EmptyContent } from "@/components/ui/empty";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { RouteError } from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/week")({
  loader: async ({ context }) => {
    if (await isPlanningOff(context)) return;
    // The stored week plan fills in when ready; the week's activities do not wait for it.
    void context.queryClient.prefetchQuery(weekCoachQueryOptions);
    await context.queryClient.query(loaderQuery(weekTargetQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: WeekTargetPending,
  errorComponent: WeekTargetError,
  component: WeekTargetPage,
});

function WeekTargetHeading() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        <TargetIcon aria-hidden className="size-5" />
        This week
      </h1>
      <p className="text-muted-foreground hidden text-sm sm:block">
        Your week day by day, built from your season, your rest days, and your form.
      </p>
    </div>
  );
}

function WeekTargetPage() {
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  if (shell.planningStyle === "off") return <PlanningOff />;
  return <PlannedWeek />;
}

/** The way back from off: the week planner's plan is still saved, one choice away. */
function PlanningOff() {
  return (
    <>
      <WeekTargetHeading />
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TargetIcon />
          </EmptyMedia>
          <EmptyTitle>Planning is off</EmptyTitle>
          <EmptyDescription>
            VO2 plans nothing for now. Season, the calendar, fitness, and the coach chat stay. Pick
            a planning style in Settings to plan your weeks again.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            nativeButton={false}
            render={<Link to="/settings/$section" params={{ section: "training" }} />}
          >
            <Settings2Icon data-icon="inline-start" />
            Choose a planning style
          </Button>
        </EmptyContent>
      </Empty>
    </>
  );
}

function PlannedWeek() {
  const { data } = useSuspenseQuery(weekTargetQueryOptions);
  const { plan } = data;

  return (
    <>
      <WeekTargetHeading />
      {!data.signedIn ? (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TargetIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to see your week</EmptyTitle>
              <EmptyDescription>
                Connect Strava so your plan starts from what you already do.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      ) : plan ? (
        <>
          <WeekView data={{ ...data, plan }} />
          <WeeksAhead weeks={data.ahead} today={data.today} />
        </>
      ) : (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TargetIcon />
            </EmptyMedia>
            <EmptyTitle>Build your plan</EmptyTitle>
            <EmptyDescription>
              Four steps from your season and your last 12 weeks, and every week is laid out day by
              day.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link to="/plan" />}>
              Build your plan
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </>
  );
}

function WeekTargetPending() {
  return (
    <>
      <WeekTargetHeading />
      <WeekViewSkeleton />
    </>
  );
}

function WeekTargetError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load this week" error={error} />;
}
