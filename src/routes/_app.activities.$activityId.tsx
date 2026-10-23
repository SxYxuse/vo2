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
import { sportTypeColor } from "@/services/athlete-settings.types.ts";
import { parseDiarySearch, type DiarySearch } from "@/services/diary-window.ts";
import { parseBestsReturn, type BestsReturn } from "@/services/personal-bests.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_app/activities/$activityId")({
  // Where the activity was opened from (a calendar period or a bests board), so the back link
  // returns there.
  validateSearch: (search: Record<string, unknown>): DiarySearch & BestsReturn => ({
    ...parseDiarySearch(search),
    ...parseBestsReturn(search),
  }),
  loader: ({ context, params }) => {
    prefetchActivityDetail(context.queryClient, params.activityId);
    return context.queryClient.query(loaderQuery(activityDetailQueryOptions(params.activityId)));
  },
  pendingMs: 200,
  pendingComponent: ActivityPending,
  errorComponent: ActivityError,
  component: ActivityPage,
});

function ActivityPage() {
  const { activityId } = Route.useParams();
  const diary = Route.useSearch();
  const { data: detail } = useSuspenseQuery(activityDetailQueryOptions(activityId));
  const settingsQuery = useQuery(settingsSnapshotQueryOptions);

  if (!detail) return <ActivityDetailMissing diary={diary} />;

  const color = sportTypeColor(settingsQuery.data?.settings.sportTypes ?? {}, detail.sportType);

  return <ActivityDetailView detail={detail} color={color} diary={diary} />;
}

function ActivityPending() {
  const diary = Route.useSearch();
  return <ActivityDetailPending diary={diary} />;
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
