import type { QueryClient } from "@tanstack/react-query";
import { noop } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";

import {
  activityAnalysisQueryOptions,
  activityDetailQueryOptions,
  analysisStatusQueryOptions,
  settingsSnapshotQueryOptions,
} from "./queries.ts";

const PREFETCH_BATCH = 4;
const PREFETCH_VISIBLE_CAP = 40;

const APP_ROUTES = ["/", "/map", "/fitness", "/heart-rate", "/settings"] as const;

export function scheduleIdle(work: () => void) {
  if (typeof window === "undefined") return () => undefined;
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => work(), { timeout: 1200 });
    return () => window.cancelIdleCallback(id);
  }
  const timer = window.setTimeout(work, 1);
  return () => window.clearTimeout(timer);
}

/** Run each signed-in route loader (and its query). */
export function warmApp(router: RegisteredRouter, queryClient: QueryClient) {
  for (const to of APP_ROUTES) {
    void router.preloadRoute({ to });
  }
  void queryClient.query(settingsSnapshotQueryOptions).catch(noop);
  void queryClient.query(analysisStatusQueryOptions).catch(noop);
}

export function prefetchActivityDetail(queryClient: QueryClient, id: string) {
  if (!id) return;
  void queryClient.query(activityDetailQueryOptions(id)).catch(noop);
  void queryClient.query(activityAnalysisQueryOptions(id)).catch(noop);
}

export function prefetchActivityDetails(queryClient: QueryClient, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, PREFETCH_VISIBLE_CAP);
  if (!unique.length) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < unique.length) {
      const id = unique[cursor];
      cursor += 1;
      if (!id) continue;
      await queryClient.query(activityDetailQueryOptions(id)).catch(noop);
      void queryClient.query(activityAnalysisQueryOptions(id)).catch(noop);
    }
  };
  void Promise.all(Array.from({ length: Math.min(PREFETCH_BATCH, unique.length) }, () => worker()));
}
