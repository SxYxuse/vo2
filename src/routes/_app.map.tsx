import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { MapIcon } from "lucide-react";

import { ActivityMap } from "@/components/activity-map.tsx";
import { SignInPanel } from "@/components/sync-panel.tsx";
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

if (typeof window !== "undefined") {
  void import("@/components/activity-map-view.tsx");
}

export const Route = createFileRoute("/_app/map")({
  ssr: false,
  loader: ({ context }) => context.queryClient.query(loaderQuery(activityMapQueryOptions)),
  pendingMs: 200,
  pendingComponent: MapPending,
  errorComponent: MapError,
  component: MapPage,
});

function MapPage() {
  const { data } = useSuspenseQuery(activityMapQueryOptions);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <MapIcon aria-hidden className="size-5" />
          Map
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Every GPS track on one map. Filter by sport.
        </p>
      </div>
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
      <div className="flex shrink-0 flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <MapIcon aria-hidden className="size-5" />
          Map
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Every GPS track on one map. Filter by sport.
        </p>
      </div>
      <Skeleton className="min-h-80 w-full flex-1 rounded-xl" />
    </div>
  );
}

function MapError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load map" error={error} />;
}
