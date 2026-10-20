import { queryOptions } from "@tanstack/react-query";

import { getActivityAnalysis, getAnalysisStatus } from "@/services/activity-analysis.ts";
import { getActivityDetail } from "@/services/activity-detail.ts";
import { loadActivityMap } from "@/services/activity-map.ts";
import { loadAppShell } from "@/services/app-shell.ts";
import { loadSettingsSnapshot } from "@/services/app-settings.ts";
import { loadHeartRate } from "@/services/heart-rate.ts";
import { loadHomeData, loadSyncStatus } from "@/services/strava-sync.ts";
import { loadFitnessData } from "@/services/training-load.ts";
import { loadWeekTarget } from "@/services/week-target.ts";

/** Loader/preload read: use cached data if present, otherwise fetch once. */
export function loaderQuery<T extends Record<string, unknown>>(options: T) {
  return { ...options, staleTime: "static" as const, retry: 1 };
}

export const appShellQueryOptions = queryOptions({
  queryKey: ["app-shell"],
  queryFn: () => loadAppShell(),
  staleTime: 60_000,
});

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

export const weekTargetQueryOptions = queryOptions({
  queryKey: ["week-target"],
  queryFn: () => loadWeekTarget(),
  staleTime: 60_000,
});

export const heartRateQueryOptions = queryOptions({
  queryKey: ["heart-rate"],
  queryFn: () => loadHeartRate(),
  staleTime: 5 * 60_000,
});

export const analysisStatusQueryOptions = queryOptions({
  queryKey: ["analysis-status"],
  queryFn: () => getAnalysisStatus(),
  staleTime: 60_000,
});

export function activityAnalysisQueryOptions(activityId: string) {
  return queryOptions({
    queryKey: ["activity-analysis", activityId] as const,
    queryFn: () => getActivityAnalysis({ data: { activityId } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function activityDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["activity", id] as const,
    queryFn: () => getActivityDetail({ data: { id } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
