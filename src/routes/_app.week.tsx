import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { TargetIcon } from "lucide-react";

import { SignInPanel } from "@/components/sync-panel.tsx";
import { WeekTargetView } from "@/components/week-target.tsx";
import {
  loaderQuery,
  seasonQueryOptions,
  weekCoachQueryOptions,
  weekTargetQueryOptions,
} from "@/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/week")({
  loader: ({ context }) => {
    // The season map and the stored day plan fill in when ready; the week does not wait.
    void context.queryClient.prefetchQuery(seasonQueryOptions);
    void context.queryClient.prefetchQuery(weekCoachQueryOptions);
    return context.queryClient.query(loaderQuery(weekTargetQueryOptions));
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
        Today’s session, your week day by day, and how it builds toward your next goal.
      </p>
    </div>
  );
}

function WeekTargetPage() {
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
                Connect Strava so the target counts what you already did.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      ) : plan ? (
        <WeekTargetView data={{ ...data, plan }} />
      ) : (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TargetIcon />
            </EmptyMedia>
            <EmptyTitle>Finish your training plan</EmptyTitle>
            <EmptyDescription>
              Set your weekly hours and week mix in Settings → Training to get a week target.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  );
}

function WeekTargetPending() {
  return (
    <>
      <WeekTargetHeading />
      <Skeleton className="h-80 w-full rounded-xl" />
    </>
  );
}

function WeekTargetError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load this week</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
