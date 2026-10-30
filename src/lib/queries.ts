import { queryOptions } from "@tanstack/react-query";

import { getActivityAnalysis, getAnalysisStatus } from "@/services/activity-analysis.ts";
import { getActivityDetail } from "@/services/activity-detail.ts";
import { loadActivityMap } from "@/services/activity-map.ts";
import { loadSettingsSnapshot } from "@/services/athlete-settings.ts";
import { loadHeartRate } from "@/services/heart-rate.ts";
import { loadHomeData } from "@/services/home-data.ts";
import { loadBests } from "@/services/personal-bests.ts";
import { loadProgress } from "@/services/progress.ts";
import { loadSeason } from "@/services/season.ts";
import { loadTopEffortCelebrations } from "@/services/top-efforts.ts";
import { loadWeekCoach } from "@/services/week-coach.ts";
import { loadPlanBuilder } from "@/services/plan-builder.ts";
import type { PlanImpact } from "@/services/plan-impact.ts";
import { loadSyncStatus } from "@/services/strava-sync.ts";
import { loadFitnessData } from "@/services/training-load.ts";
import { loadWeekTarget } from "@/services/week-target.ts";

// Apart so the sign-in page can read the app shell without loading every service's validators.
export { appShellQueryOptions, loaderQuery } from "./app-shell-query.ts";

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

export const weekTargetQueryOptions = queryOptions({
  queryKey: ["week-target"],
  queryFn: () => loadWeekTarget(),
  staleTime: 60_000,
});

export const weekCoachQueryOptions = queryOptions({
  queryKey: ["week-coach"],
  queryFn: () => loadWeekCoach(),
  staleTime: 60_000,
});

export const seasonQueryOptions = queryOptions({
  queryKey: ["season"],
  queryFn: () => loadSeason(),
  staleTime: 60_000,
});

/** The builder's starting point: Season's goals and the last 12 weeks. */
export function planBuilderQueryOptions(timeZone: string) {
  return queryOptions({
    queryKey: ["plan-builder", timeZone],
    queryFn: () => loadPlanBuilder({ data: { timeZone } }),
    staleTime: 30_000,
  });
}

/** A season change waiting for the athlete, set right after a goal changes. Client-only. */
export const seasonChangeQueryOptions = queryOptions({
  queryKey: ["season-change"],
  queryFn: (): PlanImpact | null => null,
  staleTime: Number.POSITIVE_INFINITY,
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
