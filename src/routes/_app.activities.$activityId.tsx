import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import {
  ActivityDetailMissing,
  ActivityDetailPending,
  ActivityDetailView,
} from "@/components/activity-detail.tsx";
import { prefetchActivityDetail } from "@/lib/prefetch.ts";
import {
  activityDetailQueryOptions,
  loaderQuery,
  settingsSnapshotQueryOptions,
} from "@/lib/queries.ts";
import { mergeCalendarSettings } from "@/services/calendar-settings.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_app/activities/$activityId")({
  loader: ({ context, params }) => {
    prefetchActivityDetail(context.queryClient, params.activityId);
    return context.queryClient.query(loaderQuery(activityDetailQueryOptions(params.activityId)));
  },
  pendingMs: 200,
  pendingComponent: ActivityDetailPending,
  errorComponent: ActivityError,
  component: ActivityPage,
});

function ActivityPage() {
  const { activityId } = Route.useParams();
  const { data: detail } = useSuspenseQuery(activityDetailQueryOptions(activityId));
  const settingsQuery = useQuery(settingsSnapshotQueryOptions);

  if (!detail) return <ActivityDetailMissing />;

  const color = mergeCalendarSettings(settingsQuery.data?.settings, [detail.sportType]).sportTypes[
    detail.sportType
  ]?.color;

  return <ActivityDetailView detail={detail} color={color} />;
}

function ActivityError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load activity</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
