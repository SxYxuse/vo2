"use client";

import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  fitnessQueryOptions,
  weekTargetQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
  settingsSnapshotQueryOptions,
  syncStatusQueryOptions,
} from "@/lib/queries.ts";
import { syncStrava } from "@/services/strava-sync.ts";
import {
  isTransientSyncError,
  SYNC_TRANSIENT_RETRIES,
  type SyncResult,
} from "@/services/strava-sync.types.ts";
import { toast } from "@/components/ui/toast";

export const stravaSyncMutationKey = ["strava-sync"] as const;

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function syncCopiedDescription(activitiesUpserted: number, streamsFetched: number) {
  return `Copied ${countLabel(activitiesUpserted, "activity", "activities")} and ${countLabel(streamsFetched, "stream", "streams")}.`;
}

type SyncToastOptions = Parameters<typeof toast.add>[0];

type SyncToast = {
  add: (options: SyncToastOptions) => string;
  update: (toastId: string, options: SyncToastOptions) => void;
};

/**
 * Skips the progress toast. The finish toast still shows if the athlete has left onboarding
 * by the time the copy ends, since that copy keeps running behind the app (ADR 0012).
 */
function quietToast(onOnboarding: () => boolean): SyncToast {
  return {
    add: () => "",
    update: (_toastId, options) => {
      // "info" is the copy already running elsewhere; a quiet resume has nothing to add to it.
      if (options.type === "loading" || options.type === "info" || onOnboarding()) return;
      toast.add(options);
    },
  };
}

function finishSyncToast(
  notify: SyncToast,
  toastId: string,
  result: SyncResult,
  activitiesUpserted: number,
  streamsFetched: number,
) {
  if (result.alreadyRunning) {
    notify.update(toastId, {
      type: "info",
      title: "Strava sync already running",
      description: "Another device or tab is already copying from Strava.",
      timeout: 8000,
    });
    return;
  }
  if (result.done) {
    notify.update(toastId, {
      type: "success",
      title: "Strava sync finished",
      description: syncCopiedDescription(activitiesUpserted, streamsFetched),
      timeout: 8000,
    });
    return;
  }
  if (result.pausedUntil) {
    notify.update(toastId, {
      type: "warning",
      title: "Strava sync paused",
      description: `Rate limit reached. Resume after ${new Date(result.pausedUntil).toLocaleString()}. ${result.rateLimit.dailyRemaining} daily reads remain.`,
      timeout: 10_000,
    });
    return;
  }
  notify.update(toastId, {
    type: "error",
    title: "Strava sync failed",
    description: result.lastError ?? "Sync failed",
    timeout: 10_000,
  });
}

export function useStravaSyncPending() {
  return useIsMutating({ mutationKey: stravaSyncMutationKey }) > 0;
}

export function useStravaSync({ quiet = false }: { quiet?: boolean } = {}) {
  const router = useRouter();
  const notify: SyncToast = quiet
    ? quietToast(() => router.state.location.pathname.startsWith("/onboarding"))
    : toast;
  const queryClient = useQueryClient();
  const isPending = useStravaSyncPending();

  const sync = useMutation({
    mutationKey: stravaSyncMutationKey,
    mutationFn: async () => {
      const toastId = notify.add({
        type: "loading",
        title: "Syncing from Strava",
        description: "Copying activities and streams.",
        timeout: 0,
      });
      let activitiesUpserted = 0;
      let streamsFetched = 0;
      let transientFailures = 0;
      try {
        while (true) {
          let result: SyncResult;
          try {
            result = await syncStrava();
            transientFailures = 0;
          } catch (caught) {
            if (isTransientSyncError(caught) && transientFailures < SYNC_TRANSIENT_RETRIES) {
              transientFailures += 1;
              notify.update(toastId, {
                type: "loading",
                title: "Syncing from Strava",
                description: "Connection dropped, retrying this copy.",
                timeout: 0,
              });
              continue;
            }
            throw caught;
          }
          activitiesUpserted += result.activitiesUpserted;
          streamsFetched += result.streamsFetched;
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: appShellQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: syncStatusQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: heartRateQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: activityMapQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey }),
            queryClient.invalidateQueries({ queryKey: weekTargetQueryOptions.queryKey }),
            router.invalidate(),
          ]);
          if (result.alreadyRunning || result.done || result.pausedUntil || result.lastError) {
            finishSyncToast(notify, toastId, result, activitiesUpserted, streamsFetched);
            return result;
          }
          notify.update(toastId, {
            type: "loading",
            title: "Syncing from Strava",
            description: `${syncCopiedDescription(activitiesUpserted, streamsFetched)} ${countLabel(result.streamsPending, "stream", "streams")} still to copy.`,
            timeout: 0,
          });
        }
      } catch (caught) {
        void queryClient.invalidateQueries({ queryKey: syncStatusQueryOptions.queryKey });
        notify.update(toastId, {
          type: "error",
          title: "Strava sync failed",
          description: isTransientSyncError(caught)
            ? "The copy was interrupted. Progress is saved — sync again to continue."
            : caught instanceof Error
              ? caught.message
              : "Sync failed",
          timeout: 10_000,
        });
        throw caught;
      }
    },
  });

  return {
    mutate: sync.mutate,
    isPending,
    error: sync.error,
    lastResult: sync.data,
  };
}
