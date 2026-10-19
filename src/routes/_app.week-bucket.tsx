import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { ClipboardListIcon } from "lucide-react";

import { SignInPanel } from "@/components/sync-panel.tsx";
import { WeekBucket } from "@/components/week-plan-bucket.tsx";
import { homeQueryOptions, loaderQuery } from "@/lib/queries.ts";
import { isTrainingPlanComplete } from "@/services/training-plan.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/week-bucket")({
  loader: ({ context }) => context.queryClient.query(loaderQuery(homeQueryOptions)),
  pendingMs: 200,
  pendingComponent: WeekBucketPending,
  errorComponent: WeekBucketError,
  component: WeekBucketPage,
});

function WeekBucketHeading() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        <ClipboardListIcon aria-hidden className="size-5" />
        This week’s bucket
      </h1>
      <p className="text-muted-foreground hidden text-sm sm:block">
        Planned runs and rides still to do this training week. Pick one when you have a time window;
        completed activities match themselves to open sessions.
      </p>
    </div>
  );
}

function WeekBucketPage() {
  const { data } = useSuspenseQuery(homeQueryOptions);
  const { signedIn, activities, plannedSessions, training } = data;

  return (
    <>
      <WeekBucketHeading />
      {!signedIn ? (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardListIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to fill your week</EmptyTitle>
              <EmptyDescription>
                Connect Strava so planned sessions account for what you already did.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      ) : isTrainingPlanComplete(training) ? (
        <WeekBucket activities={activities} plannedSessions={plannedSessions} plan={training} />
      ) : (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardListIcon />
            </EmptyMedia>
            <EmptyTitle>Finish your training plan</EmptyTitle>
            <EmptyDescription>
              Set build pace, hours, run and ride counts, and rest day in Settings → Training. Then
              fill the week here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  );
}

function WeekBucketPending() {
  return (
    <>
      <WeekBucketHeading />
      <Skeleton className="h-80 w-full rounded-xl" />
    </>
  );
}

function WeekBucketError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load the week bucket</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
