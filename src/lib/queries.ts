import { queryOptions } from "@tanstack/react-query";

import { getActivityDetail } from "@/services/activity-detail.ts";
import { loadActivityMap } from "@/services/activity-map.ts";
import { loadCoachCatalog, loadSettingsSnapshot } from "@/services/athlete-settings.ts";
import { listCoachChats } from "@/services/coach-chats.ts";
import { getCoachStatus } from "@/services/coach-key.ts";
import { getCoachSpending } from "@/services/coach-usage.ts";
import { RECOMMENDED_MODELS } from "@/services/coach-models.ts";
import { loadCoachPlan } from "@/services/coach-plan.ts";
import { loadHeartRate } from "@/services/heart-rate.ts";
import { loadHomeData } from "@/services/home-data.ts";
import { loadBests } from "@/services/personal-bests.ts";
import { getPowerFile, listPowerFiles } from "@/services/power-file.ts";
import { loadProgress } from "@/services/progress.ts";
import { loadSeason } from "@/services/season.ts";
import { loadTopEffortCelebrations } from "@/services/top-efforts.ts";
import { loadSyncStatus } from "@/services/strava-sync.ts";
import { listTimeOuts } from "@/services/time-outs.ts";
import { loadFitnessData } from "@/services/training-load.ts";
import { loadPredictedTimeTrend, loadTrainingPaces } from "@/services/training-paces.ts";

export { appShellQueryOptions, loaderQuery, planningStyleOf } from "./app-shell-query.ts";

export const homeQueryOptions = queryOptions({
  queryKey: ["home"],
  queryFn: () => loadHomeData(),
  staleTime: 60_000,
});

export const syncStatusQueryOptions = queryOptions({
  queryKey: ["sync-status"],
  queryFn: () => loadSyncStatus(),
  staleTime: 30_000,
});

export const settingsSnapshotQueryOptions = queryOptions({
  queryKey: ["settings-snapshot"],
  queryFn: () => loadSettingsSnapshot(),
  staleTime: 60_000,
});

export const activityMapQueryOptions = queryOptions({
  queryKey: ["activity-map"],
  queryFn: () => loadActivityMap(),
  staleTime: 60_000,
});

export const fitnessQueryOptions = queryOptions({
  queryKey: ["fitness"],
  queryFn: () => loadFitnessData(),
  staleTime: 60_000,
});

export const timeOutsQueryOptions = queryOptions({
  queryKey: ["time-outs"],
  queryFn: () => listTimeOuts(),
  staleTime: 60_000,
});

export const progressQueryOptions = queryOptions({
  queryKey: ["progress"],
  queryFn: () => loadProgress(),
  staleTime: 60_000,
});

export const bestsQueryOptions = queryOptions({
  queryKey: ["bests"],
  queryFn: () => loadBests(),
  staleTime: 60_000,
});

export const topEffortCelebrationsQueryOptions = queryOptions({
  queryKey: ["top-effort-celebrations"],
  queryFn: () => loadTopEffortCelebrations(),
  staleTime: 60_000,
});

export const coachPlanQueryOptions = queryOptions({
  queryKey: ["coach-plan"],
  queryFn: () => loadCoachPlan(),
  staleTime: 0,
  refetchInterval: (query) => (query.state.data?.status === "writing" ? 3000 : false),
});

export const seasonQueryOptions = queryOptions({
  queryKey: ["season"],
  queryFn: () => loadSeason(),
  staleTime: 60_000,
});

export const heartRateQueryOptions = queryOptions({
  queryKey: ["heart-rate"],
  queryFn: () => loadHeartRate(),
  staleTime: 5 * 60_000,
});

export const trainingPacesQueryOptions = queryOptions({
  queryKey: ["training-paces"],
  queryFn: () => loadTrainingPaces(),
  staleTime: 5 * 60_000,
});

export const predictedTimeTrendQueryOptions = queryOptions({
  queryKey: ["predicted-time-trend"],
  queryFn: () => loadPredictedTimeTrend(),
  staleTime: 5 * 60_000,
});

export const coachSpendingQueryOptions = queryOptions({
  queryKey: ["coach-spending"],
  staleTime: 0,
  queryFn: () =>
    getCoachSpending({ data: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
});

export const coachStatusQueryOptions = queryOptions({
  queryKey: ["coach-status"],
  queryFn: () => getCoachStatus(),
  staleTime: 60_000,
});

export const coachCatalogQueryOptions = queryOptions({
  queryKey: ["coach-catalog"],
  queryFn: () => loadCoachCatalog(),
  placeholderData: RECOMMENDED_MODELS,
  staleTime: Infinity,
});

export const coachChatsQueryOptions = queryOptions({
  queryKey: ["coach-chats"],
  queryFn: () => listCoachChats(),
  staleTime: 30_000,
});

export const COACH_CHAT_KEY = "coach-chat";

export function coachChatQueryKey(threadId: string) {
  return [COACH_CHAT_KEY, threadId] as const;
}

export const ACTIVITY_DETAIL_KEY = "activity";

export function activityDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: [ACTIVITY_DETAIL_KEY, id] as const,
    queryFn: () => getActivityDetail({ data: { id } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export const powerFilesQueryOptions = queryOptions({
  queryKey: ["power-files"],
  queryFn: () => listPowerFiles(),
  staleTime: 60_000,
});

export function powerFileQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["power-file", id] as const,
    queryFn: () => getPowerFile({ data: { id } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
