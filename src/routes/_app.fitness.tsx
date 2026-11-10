import { noop, useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { TrendingUpIcon } from "lucide-react";

import { FitnessChart } from "@/components/fitness-chart.tsx";
import { ProgressCards } from "@/components/progress-cards.tsx";
import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { fitnessQueryOptions, loaderQuery, progressQueryOptions } from "@/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PanelSkeleton,
  RouteError,
  StatGridSkeleton,
  ToolbarSkeleton,
} from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/fitness")({
  loader: ({ context }) => {
    // Progress reads streams and may build best efforts, so it streams in below the graph.
    void context.queryClient.query(loaderQuery(progressQueryOptions)).catch(noop);
    return context.queryClient.query(loaderQuery(fitnessQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: FitnessPending,
  errorComponent: FitnessError,
  component: FitnessPage,
});

function FitnessPage() {
  const { data } = useSuspenseQuery(fitnessQueryOptions);
  const { signedIn, fitnessLoads, goals } = data;

  return (
    <>
      <PageHeader
        icon={TrendingUpIcon}
        title="Fitness and form"
        description={"Fitness, fatigue, and form, and whether your training makes you better."}
      />
      {signedIn ? (
        <>
          <FitnessChart loads={fitnessLoads} goals={goals} />
          <ProgressCards />
        </>
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
      <PageHeader
        icon={TrendingUpIcon}
        title="Fitness and form"
        description={"Fitness, fatigue, and form, and whether your training makes you better."}
      />
      <ToolbarSkeleton />
      <Skeleton className="h-24 w-full rounded-lg" />
      <StatGridSkeleton cells={5} className="sm:grid-cols-3 lg:grid-cols-5" />
      <PanelSkeleton bodyClassName="h-56" />
    </>
  );
}

function FitnessError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load fitness" error={error} />;
}
