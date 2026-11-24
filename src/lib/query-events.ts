import type { QueryClient } from "@tanstack/react-query";

import {
  ACTIVITY_DETAIL_KEY,
  appShellQueryOptions,
  coachPlanQueryOptions,
  fitnessQueryOptions,
  homeQueryOptions,
  powerFilesQueryOptions,
  seasonQueryOptions,
  settingsSnapshotQueryOptions,
  timeOutsQueryOptions,
} from "@/lib/queries.ts";
import type { SavedAthleteSettings } from "@/services/athlete-settings.ts";

export function afterSettingsSaved(
  queryClient: QueryClient,
  saved: SavedAthleteSettings,
  { profileDone = false } = {},
) {
  queryClient.setQueryData(homeQueryOptions.queryKey, (current) =>
    current ? { ...current, settings: saved.settings } : current,
  );
  queryClient.setQueryData(settingsSnapshotQueryOptions.queryKey, (current) =>
    current
      ? {
          ...current,
          profile: saved.profile,
          settings: saved.settings,
          heartRate: saved.heartRate,
        }
      : current,
  );
  queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
    current
      ? {
          ...current,
          planningStyle: saved.settings.planningStyle,
          ...(profileDone ? { hasProfile: true } : {}),
        }
      : current,
  );
  return queryClient.invalidateQueries();
}

export function afterProfileSaved(queryClient: QueryClient) {
  queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
    current ? { ...current, hasProfile: true } : current,
  );
  return queryClient.invalidateQueries();
}

export async function afterGoalsChanged(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: seasonQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: coachPlanQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey }),
  ]);
}

export async function afterTimeOutsChanged(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: timeOutsQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: coachPlanQueryOptions.queryKey }),
  ]);
}

export async function afterLocalCopyChanged(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== ACTIVITY_DETAIL_KEY,
    }),
    queryClient.invalidateQueries({ queryKey: [ACTIVITY_DETAIL_KEY], refetchType: "none" }),
  ]);
}

export async function afterPowerFilesChanged(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: powerFilesQueryOptions.queryKey });
  void queryClient.invalidateQueries({ queryKey: [ACTIVITY_DETAIL_KEY] });
}

export function afterSignOut(queryClient: QueryClient) {
  queryClient.setQueryData(appShellQueryOptions.queryKey, {
    signedIn: false,
    hasProfile: false,
    planningStyle: null,
  });
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== appShellQueryOptions.queryKey[0],
  });
}
