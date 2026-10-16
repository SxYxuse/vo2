import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { TrendingUpIcon } from "lucide-react";

import { FitnessChart } from "#/components/fitness-chart.tsx";
import { SignInPanel } from "#/components/sync-panel.tsx";
import { fitnessQueryOptions, loaderQuery } from "#/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/fitness")({
  loader: ({ context }) =>
    context.queryClient.query(loaderQuery(fitnessQueryOptions)),
  pendingMs: 200,
  pendingComponent: FitnessPending,
  errorComponent: FitnessError,
  component: FitnessPage,
});

function FitnessPage() {
  const { data } = useSuspenseQuery(fitnessQueryOptions);
  const { signedIn, fitnessLoads } = data;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <TrendingUpIcon aria-hidden className="size-5" />
          Fitness and form
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Track fitness, fatigue, and form so you can keep building without overreaching.
        </p>
      </div>
      {signedIn ? (
        <FitnessChart loads={fitnessLoads} />
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TrendingUpIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to see fitness</EmptyTitle>
              <EmptyDescription>
                Connect Strava to build fitness, fatigue, and form from your activities.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      )}
    </>
  );
}

function FitnessPending() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <TrendingUpIcon aria-hidden className="size-5" />
          Fitness and form
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Track fitness, fatigue, and form so you can keep building without overreaching.
        </p>
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </>
  );
}

function FitnessError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load fitness</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
