"use client";

import { useEffect, useState, type ComponentType } from "react";

import type { CalendarSettings } from "#/services/calendar-settings.types.ts";
import type { ActivityMapTrack } from "#/services/activity-map.types.ts";
import { Skeleton } from "@/components/ui/skeleton";

export type ActivityMapProps = {
  tracks: ActivityMapTrack[];
  sportTypes: CalendarSettings["sportTypes"];
  sportGroupShares: CalendarSettings["sportGroupShares"];
};

export function ActivityMap(props: ActivityMapProps) {
  const [View, setView] = useState<ComponentType<ActivityMapProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./activity-map-view.tsx").then((mod) => {
      if (!cancelled) setView(() => mod.ActivityMapView);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!View) {
    return <Skeleton className="min-h-80 w-full flex-1 rounded-xl" />;
  }
  return <View {...props} />;
}
