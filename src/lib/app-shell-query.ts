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

/** The athlete's planning style, for routes that load differently by style (ADR 0037). */
export async function planningStyleOf(context: {
  queryClient: QueryClient;
  offlineCopyRestored: Promise<void>;
}) {
  await context.offlineCopyRestored;
  const shell = await context.queryClient.query(loaderQuery(appShellQueryOptions));
  return shell.planningStyle;
}
