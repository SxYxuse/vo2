"use client";

import { lazy, Suspense } from "react";

import type { CalendarSettings } from "#/services/calendar-settings.types.ts";
import type { ActivityMapTrack } from "#/services/activity-map.types.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export type ActivityMapProps = {
  tracks: ActivityMapTrack[];
  sportTypes: CalendarSettings["sportTypes"];
  sportGroupShares: CalendarSettings["sportGroupShares"];
};

const ActivityMapView = lazy(() =>
  import("./activity-map-view.tsx").then((mod) => ({ default: mod.ActivityMapView })),
);

export function ActivityMap(props: ActivityMapProps) {
  if (props.tracks.length === 0) {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyTitle>No GPS tracks yet</EmptyTitle>
          <EmptyDescription>
            Sync outdoor activities from Strava that include a map. Indoor sessions without a GPS
            path stay off this view.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Suspense fallback={<Skeleton className="min-h-80 w-full flex-1 rounded-xl" />}>
      <ActivityMapView {...props} />
    </Suspense>
  );
}
