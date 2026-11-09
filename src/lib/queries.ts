import { queryOptions } from "@tanstack/react-query";

import { getActivityDetail } from "@/services/activity-detail.ts";
import { loadActivityMap } from "@/services/activity-map.ts";
import { loadCoachCatalog, loadSettingsSnapshot } from "@/services/athlete-settings.ts";
import { listCoachChats } from "@/services/coach-chats.ts";
import { getCoachStatus } from "@/services/coach-key.ts";
import { RECOMMENDED_MODELS } from "@/services/coach-models.ts";
import { loadCoachPlan } from "@/services/coach-plan.ts";
import { loadHeartRate } from "@/services/heart-rate.ts";
import { loadHomeData } from "@/services/home-data.ts";
import { loadBests } from "@/services/personal-bests.ts";
import { getPowerFile, listPowerFiles } from "@/services/power-file.ts";
import { loadProgress } from "@/services/progress.ts";
import { getRouteBuilderStatus } from "@/services/route-builder.ts";
import { loadSeason } from "@/services/season.ts";
import { loadTopEffortCelebrations } from "@/services/top-efforts.ts";
import { loadSyncStatus } from "@/services/strava-sync.ts";
import { loadFitnessData } from "@/services/training-load.ts";
import { loadTrainingPaces } from "@/services/training-paces.ts";

// Apart so the sign-in page can read the app shell without loading every service's validators.
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

export const routeBuilderStatusQueryOptions = queryOptions({
  queryKey: ["route-builder-status"],
  queryFn: () => getRouteBuilderStatus(),
  staleTime: 5 * 60_000,
});

export const fitnessQueryOptions = queryOptions({
  queryKey: ["fitness"],
  queryFn: () => loadFitnessData(),
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

/**
 * The coach plan. It changes on the server by itself (writing finishes, a new week is due), so
 * the saved copy shows at once and is checked again on every visit, and every few seconds while
 * the server writes it.
 */
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

export const coachStatusQueryOptions = queryOptions({
  queryKey: ["coach-status"],
  queryFn: () => getCoachStatus(),
  staleTime: 60_000,
});

/**
 * The models the coach model picker offers. The recommended ones stand in until it loads, so the
 * picker works offline; the catalog only changes with a deploy.
 */
export const coachCatalogQueryOptions = queryOptions({
  queryKey: ["coach-catalog"],
  queryFn: () => loadCoachCatalog(),
  placeholderData: RECOMMENDED_MODELS,
  staleTime: Infinity,
});

/** The athlete's coach chats, newest first; each opens from the list in the coach chat. */
export const coachChatsQueryOptions = queryOptions({
  queryKey: ["coach-chats"],
  queryFn: () => listCoachChats(),
  staleTime: 30_000,
});

/**
 * The last chat the athlete opened, as shown, so it still reads offline. Client-only: the chat
 * loads from the server through TanStack AI and writes here.
 */
export function coachChatQueryKey(threadId: string) {
  return ["coach-chat", threadId] as const;
}

export function activityDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["activity", id] as const,
    queryFn: () => getActivityDetail({ data: { id } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/** Imported FIT files, newest ride first; saved on the device like the other lists. */
export const powerFilesQueryOptions = queryOptions({
  queryKey: ["power-files"],
  queryFn: () => listPowerFiles(),
  staleTime: 60_000,
});

/** One file's analysis. Like an activity's streams it is large, so it is not kept offline. */
export function powerFileQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["power-file", id] as const,
    queryFn: () => getPowerFile({ data: { id } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
