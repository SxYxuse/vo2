"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { syncStatusQueryOptions } from "@/lib/queries.ts";
import { useStravaSync } from "@/hooks/use-strava-sync.ts";
import { autoResumePlan } from "@/services/strava-sync.types.ts";

const PAUSE_SLACK_MS = 5_000;

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
      const plan = autoResumePlan(latest);
      if (plan.kind === "sync") syncRef.current.mutate();
      if (plan.kind === "check") syncRef.current.mutate({ silent: true });
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
    const plan = autoResumePlan({ status: "paused", pausedUntil, lastAttemptAt: null });
    if (plan.kind !== "wait") return;
    const timer = setTimeout(
      () => void checkRef.current(),
      plan.until - Date.now() + PAUSE_SLACK_MS,
    );
    return () => clearTimeout(timer);
  }, [pausedUntil]);
}
