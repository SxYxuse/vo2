"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { syncStatusQueryOptions } from "@/lib/queries.ts";
import { useStravaSync } from "@/hooks/use-strava-sync.ts";
import { autoResumePlan } from "@/services/strava-sync.types.ts";

/** Strava's window can open a little after `pausedUntil`; wait past it so the first read lands. */
const PAUSE_SLACK_MS = 5_000;

/**
 * Finishes an incomplete local copy while the app is open and in the foreground: on open, on
 * return from the background, and when a rate-limit pause ends (ADR 0012). It only reacts to
 * those moments, never to every status change, so a copy that keeps dropping does not loop.
 */
export function useSyncAutoResume() {
  const queryClient = useQueryClient();
  const sync = useStravaSync({ quiet: true });
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const { data: status } = useQuery(syncStatusQueryOptions);
  const checkRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;

    checkRef.current = async () => {
      if (cancelled || document.visibilityState !== "visible" || syncRef.current.isPending) return;
      const latest = await queryClient.fetchQuery({ ...syncStatusQueryOptions, staleTime: 0 });
      if (cancelled || syncRef.current.isPending) return;
      if (autoResumePlan(latest).kind === "sync") syncRef.current.mutate();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkRef.current();
    };
    void checkRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queryClient]);

  const pausedUntil = status?.status === "paused" ? status.pausedUntil : null;
  useEffect(() => {
    if (!pausedUntil) return;
    const plan = autoResumePlan({ status: "paused", pausedUntil });
    if (plan.kind !== "wait") return;
    const timer = setTimeout(
      () => void checkRef.current(),
      plan.until - Date.now() + PAUSE_SLACK_MS,
    );
    return () => clearTimeout(timer);
  }, [pausedUntil]);
}
