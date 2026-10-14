import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { HeartPulseIcon } from "lucide-react";

import { HeartRateZones } from "#/components/heart-rate-zones.tsx";
import { SignInPanel } from "#/components/sync-panel.tsx";
import { heartRateQueryOptions, homeQueryOptions } from "#/lib/queries.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/heart-rate")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(heartRateQueryOptions),
      context.queryClient.ensureQueryData(homeQueryOptions),
    ]),
  pendingMs: 200,
  pendingComponent: HeartRatePending,
  errorComponent: HeartRateError,
  component: HeartRatePage,
});

function HeartRatePage() {
  const { data } = useSuspenseQuery(heartRateQueryOptions);
  const { data: home } = useSuspenseQuery(homeQueryOptions);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <HeartPulseIcon aria-hidden className="size-5 text-ds-red-700" />
          Heart rate
        </h1>
        <p className="text-muted-foreground text-sm">
          Max heart rate, estimated zones, and time in zone — overall and per sport.
        </p>
      </div>
      {data.signedIn ? (
        <HeartRateZones data={data} sportTypes={home.settings.sportTypes} />
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HeartPulseIcon className="text-ds-red-700" />
              </EmptyMedia>
              <EmptyTitle>Sign in to see heart rate</EmptyTitle>
              <EmptyDescription>
                Connect Strava to estimate zones from your recorded heart-rate data.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      )}
    </>
  );
}

function HeartRatePending() {
  return (
    <>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </>
  );
}

function HeartRateError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load heart rate</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
