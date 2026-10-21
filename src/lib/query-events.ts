import type { QueryClient } from "@tanstack/react-query";

import {
  appShellQueryOptions,
  homeQueryOptions,
  settingsSnapshotQueryOptions,
} from "@/lib/queries.ts";
import type { SavedAthleteSettings } from "@/services/athlete-settings.ts";

/*
 * Callers name what happened; this module decides what goes stale. Settings, the profile, and
 * the local copy feed nearly every query, so those events refresh all of them: only queries on
 * screen refetch, and a new query is covered without editing a key list.
 */

/** Settings and training plan show at once; every view built on them refetches. */
export function afterSettingsSaved(
  queryClient: QueryClient,
  saved: SavedAthleteSettings,
  { profileDone = false } = {},
) {
  queryClient.setQueryData(homeQueryOptions.queryKey, (current) =>
    current ? { ...current, settings: saved.settings, training: saved.training } : current,
  );
  queryClient.setQueryData(settingsSnapshotQueryOptions.queryKey, (current) =>
    current
      ? { ...current, profile: saved.profile, settings: saved.settings, training: saved.training }
      : current,
  );
  queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
    current
      ? { ...current, training: saved.training, ...(profileDone ? { hasProfile: true } : {}) }
      : current,
  );
  return queryClient.invalidateQueries();
}

/** Age reshapes max HR, zones, and training load on every page. */
export function afterProfileSaved(queryClient: QueryClient) {
  queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
    current ? { ...current, hasProfile: true } : current,
  );
  return queryClient.invalidateQueries();
}

/** A sync call copied activities or streams, so every view of the local copy refetches. */
export function afterLocalCopyChanged(queryClient: QueryClient) {
  return queryClient.invalidateQueries();
}

/** Nothing cached for the athlete may outlive the session; the shell shows signed out at once. */
export function afterSignOut(queryClient: QueryClient) {
  queryClient.setQueryData(appShellQueryOptions.queryKey, {
    signedIn: false,
    training: null,
    hasProfile: false,
  });
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== appShellQueryOptions.queryKey[0],
  });
}
