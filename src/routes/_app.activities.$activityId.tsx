import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";

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
import { parseBestsReturn, type BestsReturn } from "@/services/bests-search.ts";
import { RouteError } from "@/components/route-states.tsx";

type ActivitySearch = DiarySearch & BestsReturn & { map?: true };

export const Route = createFileRoute("/_app/activities/$activityId")({
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    ...parseDiarySearch(search),
    ...parseBestsReturn(search),
    ...(search.map === true ? { map: true as const } : {}),
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
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { data: detail } = useSuspenseQuery(activityDetailQueryOptions(activityId));
  const settingsQuery = useQuery(settingsSnapshotQueryOptions);

  if (!detail) return <ActivityDetailMissing diary={diary} />;

  const color = sportTypeColor(settingsQuery.data?.settings.sportTypes ?? {}, detail.sportType);

  const onMapOpenChange = (open: boolean) => {
    if (open) {
      void navigate({
        search: (prev) => ({ ...prev, map: true }),
        state: (prev) => ({ ...prev, activityMapPushed: true }),
        resetScroll: false,
      });
      return;
    }
    if (router.state.location.state.activityMapPushed) {
      router.history.back();
      return;
    }
    void navigate({
      search: ({ map: _map, ...rest }) => rest,
      replace: true,
      resetScroll: false,
    });
  };

  return (
    <ActivityDetailView
      detail={detail}
      color={color}
      diary={diary}
      mapOpen={diary.map === true}
      onMapOpenChange={onMapOpenChange}
    />
  );
}

function ActivityPending() {
  const diary = Route.useSearch();
  return <ActivityDetailPending diary={diary} />;
}

function ActivityError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load activity" error={error} />;
}
