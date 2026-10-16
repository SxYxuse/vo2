import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, type ErrorComponentProps } from "@tanstack/react-router";
import { CalendarDaysIcon } from "lucide-react";

import { ActivityCalendar } from "@/components/activity-calendar.tsx";
import { homeQueryOptions, loaderQuery } from "@/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type HomeSearch = {
  activity?: string;
};

export const Route = createFileRoute("/_app/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const activity = search.activity;
    if (typeof activity === "string" && activity.length > 0) return { activity };
    if (typeof activity === "number" && Number.isFinite(activity)) {
      return { activity: String(activity) };
    }
    return {};
  },
  beforeLoad: ({ search }) => {
    if (search.activity) {
      throw redirect({
        to: "/activities/$activityId",
        params: { activityId: search.activity },
      });
    }
  },
  loader: ({ context }) => context.queryClient.query(loaderQuery(homeQueryOptions)),
  pendingMs: 200,
  pendingComponent: CalendarPending,
  errorComponent: CalendarError,
  component: CalendarPage,
});

function CalendarPage() {
  const { data } = useSuspenseQuery(homeQueryOptions);
  const { signedIn, activities, settings } = data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <CalendarDaysIcon aria-hidden className="size-5" />
          Activity calendar
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Completed Strava activities by training week. Planned sessions live in the Week bucket;
          field tests live on Tests.
        </p>
      </div>
      {signedIn && activities.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDaysIcon />
            </EmptyMedia>
            <EmptyTitle>No activities yet</EmptyTitle>
            <EmptyDescription>
              Sync from Strava to fill the calendar with completed activities.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ActivityCalendar activities={activities} initialSettings={settings} />
      )}
    </div>
  );
}

function CalendarPending() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <CalendarDaysIcon aria-hidden className="size-5" />
          Activity calendar
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Completed Strava activities by training week. Planned sessions live in the Week bucket;
          field tests live on Tests.
        </p>
      </div>
      <Skeleton className="h-[40rem] w-full rounded-xl" />
    </div>
  );
}

function CalendarError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load calendar</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
