import type { QueryClient } from "@tanstack/react-query";
import { noop } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";

import {
  activityAnalysisQueryOptions,
  activityDetailQueryOptions,
  coachStatusQueryOptions,
  settingsSnapshotQueryOptions,
} from "./queries.ts";

const PREFETCH_BATCH = 4;
const PREFETCH_VISIBLE_CAP = 40;

const APP_ROUTES = ["/", "/week", "/season", "/coach", "/map", "/fitness", "/heart-rate"] as const;

// On a slow connection, other pages' chunks and data would compete with the page the athlete
// just opened, its map tiles included; warm them once it has had time to settle.
const SETTLE_MS = 5000;

/** Runs `work` when the browser is idle, a few seconds after the page opened. */
export function afterPageSettles(work: () => void) {
  if (typeof window === "undefined") return () => undefined;
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback !== "function") return work();
    idle = window.requestIdleCallback(() => work(), { timeout: 1200 });
  }, SETTLE_MS);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

/** Run each signed-in route loader (and its query). */
export function warmApp(router: RegisteredRouter, queryClient: QueryClient) {
  for (const to of APP_ROUTES) {
    void router.preloadRoute({ to });
  }
  void router.preloadRoute({ to: "/settings/$section", params: { section: "profile" } });
  void queryClient.query(settingsSnapshotQueryOptions).catch(noop);
  void queryClient.query(coachStatusQueryOptions).catch(noop);
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
