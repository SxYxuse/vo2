import { useState } from "react";
import { noop, useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { ThermometerIcon, TrendingUpIcon } from "lucide-react";

import { FitnessChart } from "@/components/fitness-chart.tsx";
import { ProgressCards } from "@/components/progress-cards.tsx";
import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { TimeOutSheet, type TimeOutEditing } from "@/components/time-out-sheet.tsx";
import { Button } from "@/components/ui/button";
import {
  fitnessQueryOptions,
  loaderQuery,
  progressQueryOptions,
  timeOutsQueryOptions,
} from "@/lib/queries.ts";
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
    return Promise.all([
      context.queryClient.query(loaderQuery(fitnessQueryOptions)),
      context.queryClient.query(loaderQuery(timeOutsQueryOptions)),
    ]);
  },
  pendingMs: 200,
  pendingComponent: FitnessPending,
  errorComponent: FitnessError,
  component: FitnessPage,
});

function FitnessPage() {
  const { data } = useSuspenseQuery(fitnessQueryOptions);
  const { signedIn, fitnessLoads, goals } = data;
  const { timeOuts } = useSuspenseQuery(timeOutsQueryOptions).data;
  const [editing, setEditing] = useState<TimeOutEditing>(null);

  return (
    <>
      <PageHeader
        icon={TrendingUpIcon}
        title="Fitness and form"
        actions={
          signedIn ? (
            <Button type="button" variant="outline" onClick={() => setEditing("new")}>
              <ThermometerIcon data-icon="inline-start" />
              Sick or injured
            </Button>
          ) : null
        }
      />
      {signedIn ? (
        <>
          <FitnessChart
            loads={fitnessLoads}
            goals={goals}
            timeOuts={timeOuts}
            onEditTimeOut={setEditing}
          />
          <TimeOutSheet editing={editing} onClose={() => setEditing(null)} />
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
      <PageHeader icon={TrendingUpIcon} title="Fitness and form" />
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
