import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { MapIcon } from "lucide-react";

import { ActivityMap } from "@/components/activity-map.tsx";
import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { activityMapQueryOptions, loaderQuery } from "@/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteError } from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/map")({
  ssr: false,
  loader: ({ context }) => {
    // Fetch MapLibre alongside the tracks, on preload too, but never at app start: a module-level
    // import here ran on every page because the route's config ships in the main bundle.
    void import("@/components/activity-map-view.tsx");
    return context.queryClient.query(loaderQuery(activityMapQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: MapPending,
  errorComponent: MapError,
  component: MapPage,
});

function MapPage() {
  const { data } = useSuspenseQuery(activityMapQueryOptions);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader icon={MapIcon} title="Map" description={"Every GPS track on one map."} />
      {data.signedIn ? (
        <ActivityMap
          tracks={data.tracks}
          sportTypes={data.sportTypes}
          sportGroupShares={data.sportGroupShares}
        />
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MapIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to see your map</EmptyTitle>
              <EmptyDescription>
                Connect Strava to plot ride and run passages from your activity GPS.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      )}
    </div>
  );
}

function MapPending() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader icon={MapIcon} title="Map" description={"Every GPS track on one map."} />
      <Skeleton className="min-h-80 w-full flex-1 rounded-xl" />
    </div>
  );
}

function MapError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load map" error={error} />;
}
