import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { CalendarDaysIcon } from "lucide-react";

import { ActivityCalendar } from "#/components/activity-calendar.tsx";
import { SignInPanel, SyncPanel } from "#/components/sync-panel.tsx";
import { activityDetailQueryOptions, homeQueryOptions } from "#/lib/queries.ts";
import { isTrainingPlanComplete } from "#/services/training-plan.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
  loaderDeps: ({ search }) => ({ activity: search.activity }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(homeQueryOptions),
      deps.activity
        ? context.queryClient.ensureQueryData(activityDetailQueryOptions(deps.activity))
        : null,
    ]),
  pendingMs: 200,
  pendingComponent: CalendarPending,
  errorComponent: CalendarError,
  component: CalendarPage,
});

function CalendarPage() {
  const { data } = useSuspenseQuery(homeQueryOptions);
  const { activity } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { signedIn, activities, status, settings, plannedSessions, training } = data;

  function selectActivity(id: string | null) {
    void navigate({
      search: (prev) => {
        if (id) return { ...prev, activity: id };
        const { activity: _removed, ...rest } = prev;
        return rest;
      },
      replace: !id,
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <CalendarDaysIcon aria-hidden className="size-5 text-ds-blue-700" />
          Activity calendar
        </h1>
        <p className="text-muted-foreground text-sm">
          Import Strava activities and streams into local Postgres, then browse them by day. Open
          This week for a bucket of suggested workouts to fill when you have time. Field tests live
          on Tests.
        </p>
      </div>
      {signedIn ? (
        <SyncPanel
          activityCount={status?.activityCount ?? activities.length}
          streamsPending={status?.streamsPending ?? 0}
          status={status?.status ?? "idle"}
          pausedUntil={status?.pausedUntil ?? null}
          lastError={status?.lastError ?? null}
          shortLimitRemaining={status?.shortLimitRemaining ?? null}
          dailyLimitRemaining={status?.dailyLimitRemaining ?? null}
        />
      ) : (
        <SignInPanel />
      )}
      <ActivityCalendar
        activities={activities}
        plannedSessions={plannedSessions}
        training={isTrainingPlanComplete(training) ? training : null}
        initialSettings={settings}
        persist={signedIn}
        selectedActivityId={activity ?? null}
        onSelectActivity={selectActivity}
      />
    </>
  );
}

function CalendarPending() {
  return (
    <>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-[40rem] w-full rounded-xl" />
    </>
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
