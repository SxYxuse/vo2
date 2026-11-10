import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { HeartPulseIcon } from "lucide-react";

import { HeartRateZones } from "@/components/heart-rate-zones.tsx";
import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { heartRateQueryOptions, loaderQuery } from "@/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  PanelSkeleton,
  RouteError,
  StatGridSkeleton,
  ToolbarSkeleton,
} from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/heart-rate")({
  loader: ({ context }) => context.queryClient.query(loaderQuery(heartRateQueryOptions)),
  pendingMs: 200,
  pendingComponent: HeartRatePending,
  errorComponent: HeartRateError,
  component: HeartRatePage,
});

function HeartRatePage() {
  const { data } = useSuspenseQuery(heartRateQueryOptions);

  return (
    <>
      <PageHeader
        icon={HeartPulseIcon}
        title="Heart rate"
        description={"Your zones, time in zone, and how efficient your heart is, per sport."}
      />
      {data.signedIn ? (
        <HeartRateZones data={data} sportTypes={data.sportTypes} />
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HeartPulseIcon />
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
      <PageHeader
        icon={HeartPulseIcon}
        title="Heart rate"
        description={"Your zones, time in zone, and how efficient your heart is, per sport."}
      />
      <ToolbarSkeleton widths={["w-44", "w-48"]} />
      <StatGridSkeleton cells={4} className="lg:grid-cols-4" />
      <PanelSkeleton bodyClassName="h-56" />
    </>
  );
}

function HeartRateError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load heart rate" error={error} />;
}
