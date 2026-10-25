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
import { parseDiarySearch, type DiarySearch } from "@/services/diary-window.ts";
import { ListSkeleton, RouteError, ToolbarSkeleton } from "@/components/route-states.tsx";

type HomeSearch = DiarySearch & {
  activity?: string;
};

export const Route = createFileRoute("/_app/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const activity = search.activity;
    const normalizedActivity =
      typeof activity === "string" && activity.length > 0
        ? activity
        : typeof activity === "number" && Number.isFinite(activity)
          ? String(activity)
          : undefined;
    return {
      ...(normalizedActivity ? { activity: normalizedActivity } : {}),
      ...parseDiarySearch(search),
    };
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
  const { month, week } = Route.useSearch();
  const { data } = useSuspenseQuery(homeQueryOptions);
  const { signedIn, activities, goals, settings } = data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <CalendarDaysIcon aria-hidden className="size-5" />
          Activity calendar
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Completed Strava activities. Time left lives on the This week page.
        </p>
      </div>
      {signedIn && Object.keys(settings.sportTypes).length === 0 ? (
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
        <ActivityCalendar
          activities={activities}
          goals={goals}
          initialSettings={settings}
          diary={{ month, week }}
        />
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
          Completed Strava activities. Time left lives on the This week page.
        </p>
      </div>
      <ToolbarSkeleton widths={["w-60"]} />
      <ListSkeleton rows={7} className="md:hidden" />
      <div className="ring-foreground/10 hidden grid-cols-7 gap-px overflow-hidden rounded-lg ring-1 md:grid">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="bg-card flex h-28 flex-col justify-between p-2">
            <Skeleton className="h-5 w-full rounded-sm" />
            <Skeleton className="size-4 self-end rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load calendar" error={error} />;
}
