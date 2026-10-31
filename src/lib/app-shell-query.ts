import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { loadAppShell } from "@/services/app-shell.ts";

/**
 * Loader/preload read: use cached data if present, otherwise fetch once. Offline with nothing
 * saved, it fails to the route's error state instead of pausing on a skeleton until reconnect.
 */
export function loaderQuery<T extends Record<string, unknown>>(options: T) {
  return { ...options, staleTime: "static" as const, retry: 1, networkMode: "always" as const };
}

export const appShellQueryOptions = queryOptions({
  queryKey: ["app-shell"],
  queryFn: () => loadAppShell(),
  staleTime: 60_000,
});

/** For the week planner's routes: with planning off they have nothing to load (ADR 0037). */
export async function isPlanningOff(context: {
  queryClient: QueryClient;
  offlineCopyRestored: Promise<void>;
}) {
  await context.offlineCopyRestored;
  const shell = await context.queryClient.query(loaderQuery(appShellQueryOptions));
  return shell.planningStyle === "off";
}
