import type { QueryClient } from "@tanstack/react-query";

import {
  activityAnalysisQueryOptions,
  activityDetailQueryOptions,
  activityMapQueryOptions,
  analysisStatusQueryOptions,
  assessmentsQueryOptions,
  fitnessQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
  settingsSnapshotQueryOptions,
} from "./queries.ts";

export type AppPath = "/" | "/map" | "/fitness" | "/heart-rate" | "/tests";

const PREFETCH_BATCH = 4;
const PREFETCH_VISIBLE_CAP = 40;

export function scheduleIdle(work: () => void) {
  if (typeof window === "undefined") return () => undefined;
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => work(), { timeout: 1200 });
    return () => window.cancelIdleCallback(id);
  }
  const timer = window.setTimeout(work, 1);
  return () => window.clearTimeout(timer);
}

export function preloadActivityUi() {
  void import("#/components/activity-detail-dialog.tsx");
  void import("#/components/activity-detail-charts.tsx");
  void import("#/components/activity-analysis.tsx");
  void import("#/components/activity-analysis-live.tsx");
  void import("#/components/planned-session-dialog.tsx");
}

export function preloadRouteChunk(to: AppPath) {
  if (to === "/") {
    void import("#/components/activity-calendar.tsx");
    preloadActivityUi();
    return;
  }
  if (to === "/map") {
    void import("#/components/activity-map.tsx");
    void import("#/components/activity-map-view.tsx");
    void import("#/components/ui/map.tsx");
    return;
  }
  if (to === "/fitness") {
    void import("#/components/fitness-chart.tsx");
    return;
  }
  if (to === "/heart-rate") {
    void import("#/components/heart-rate-zones.tsx");
    return;
  }
  void import("#/components/assessment-tests.tsx");
}

export function preloadAppChunks() {
  preloadRouteChunk("/");
  preloadRouteChunk("/map");
  preloadRouteChunk("/fitness");
  preloadRouteChunk("/heart-rate");
  preloadRouteChunk("/tests");
  void import("#/components/settings-dialog.tsx");
  void import("#/components/onboarding-dialog.tsx");
}

export function prefetchRouteData(queryClient: QueryClient, to: AppPath) {
  if (to === "/") return queryClient.prefetchQuery(homeQueryOptions);
  if (to === "/map") return queryClient.prefetchQuery(activityMapQueryOptions);
  if (to === "/fitness") return queryClient.prefetchQuery(fitnessQueryOptions);
  if (to === "/heart-rate") return queryClient.prefetchQuery(heartRateQueryOptions);
  return queryClient.prefetchQuery(assessmentsQueryOptions);
}

export function warmRoute(queryClient: QueryClient, to: AppPath) {
  preloadRouteChunk(to);
  void prefetchRouteData(queryClient, to);
}

export async function prefetchSignedInQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.prefetchQuery(homeQueryOptions),
    queryClient.prefetchQuery(fitnessQueryOptions),
    queryClient.prefetchQuery(assessmentsQueryOptions),
    queryClient.prefetchQuery(settingsSnapshotQueryOptions),
    queryClient.prefetchQuery(analysisStatusQueryOptions),
  ]);
  await queryClient.prefetchQuery(activityMapQueryOptions);
  await queryClient.prefetchQuery(heartRateQueryOptions);
}

export function prefetchActivityDetail(queryClient: QueryClient, id: string) {
  if (!id) return;
  preloadActivityUi();
  void queryClient.prefetchQuery(activityDetailQueryOptions(id));
  void queryClient.prefetchQuery(activityAnalysisQueryOptions(id));
}

export function prefetchActivityDetails(queryClient: QueryClient, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, PREFETCH_VISIBLE_CAP);
  if (!unique.length) return;
  preloadActivityUi();
  let cursor = 0;
  const worker = async () => {
    while (cursor < unique.length) {
      const id = unique[cursor];
      cursor += 1;
      if (!id) continue;
      await queryClient.prefetchQuery(activityDetailQueryOptions(id));
      void queryClient.prefetchQuery(activityAnalysisQueryOptions(id));
    }
  };
  void Promise.all(Array.from({ length: Math.min(PREFETCH_BATCH, unique.length) }, () => worker()));
}
