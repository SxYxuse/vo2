import type { QueryClient } from "@tanstack/react-query";

import {
  activityDetailQueryOptions,
  appShellQueryOptions,
  coachPlanQueryOptions,
  fitnessQueryOptions,
  homeQueryOptions,
  seasonChangeQueryOptions,
  seasonQueryOptions,
  settingsSnapshotQueryOptions,
  weekCoachQueryOptions,
  weekTargetQueryOptions,
} from "@/lib/queries.ts";
import type { SavedAthleteSettings } from "@/services/athlete-settings.ts";
import { planningStyleOf } from "@/services/athlete-settings.types.ts";
import { checkSeason } from "@/services/plan-builder.ts";
import type { SeasonCheck } from "@/services/plan-builder.types.ts";
import { isTrainingPlanComplete, type TrainingPlan } from "@/services/training-plan.types.ts";

/*
 * Callers name what happened; this module decides what goes stale. Settings, the profile, and
 * the local copy feed nearly every query, so those events refresh all of them: only queries on
 * screen refetch, and a new query is covered without editing a key list.
 */

/** Settings and training plan show at once; every view built on them goes stale. */
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
      ? {
          ...current,
          profile: saved.profile,
          settings: saved.settings,
          training: saved.training,
          heartRate: saved.heartRate,
        }
      : current,
  );
  queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
    current
      ? {
          ...current,
          training: saved.training,
          planningStyle: planningStyleOf(
            saved.settings.planningStyle,
            isTrainingPlanComplete(saved.training),
          ),
          ...(profileDone ? { hasProfile: true } : {}),
        }
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

/**
 * Goals set the week's plan and show on the calendar and fitness chart. The plan reads its own
 * copy of them (ADR 0026): a change it can take quietly goes in, one that reshapes the current
 * block waits for the athlete, shown by SeasonChangePrompt.
 */
export async function afterGoalsChanged(queryClient: QueryClient): Promise<SeasonCheck | null> {
  const check = await checkSeason().catch(() => null);
  queryClient.setQueryData(seasonChangeQueryOptions.queryKey, check?.impact ?? null);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: seasonQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: weekTargetQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: weekCoachQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: coachPlanQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey }),
    queryClient.invalidateQueries({ queryKey: ["plan-builder"] }),
  ]);
  return check;
}

/** A plan built, rebuilt, or adapted: the shell, settings, and every planned view go stale. */
export function afterPlanChanged(queryClient: QueryClient, plan?: TrainingPlan | null) {
  if (plan !== undefined) {
    queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
      current ? { ...current, training: plan } : current,
    );
    queryClient.setQueryData(settingsSnapshotQueryOptions.queryKey, (current) =>
      current ? { ...current, training: plan } : current,
    );
  }
  return queryClient.invalidateQueries();
}

/** A sync call copied activities or streams, so every view of the local copy goes stale. */
export async function afterLocalCopyChanged(queryClient: QueryClient) {
  const detail = activityDetailQueryOptions("").queryKey[0];
  await Promise.all([
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== detail }),
    // Sync resumes on its own while the app is open, so refetching an open activity's streams
    // after every call would download them again on each pass of a long stream copy.
    queryClient.invalidateQueries({ queryKey: [detail], refetchType: "none" }),
  ]);
}

/** Nothing cached for the athlete may outlive the session; the shell shows signed out at once. */
export function afterSignOut(queryClient: QueryClient) {
  queryClient.setQueryData(appShellQueryOptions.queryKey, {
    signedIn: false,
    training: null,
    hasProfile: false,
    planningStyle: null,
  });
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== appShellQueryOptions.queryKey[0],
  });
}
