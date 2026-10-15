"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";

import { authClient } from "#/lib/auth-client.ts";
import {
  activityMapQueryOptions,
  appShellQueryOptions,
  fitnessQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
} from "#/lib/queries.ts";
import { syncStrava } from "#/services/strava-sync.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SyncPanelProps = {
  activityCount: number;
  streamsPending: number;
  status: string;
  pausedUntil: string | null;
  lastError: string | null;
  shortLimitRemaining: number | null;
  dailyLimitRemaining: number | null;
};

export function SyncPanel(props: SyncPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(props.lastError);

  const sync = useMutation({
    mutationFn: async () => {
      setError(null);
      setMessage("Fetching activities from Strava…");
      while (true) {
        const result = await syncStrava();
        setMessage(
          `Stored ${result.activitiesUpserted} activities, ${result.streamsFetched} streams this batch, ${result.streamsPending} streams left.`,
        );
        await queryClient.invalidateQueries({ queryKey: appShellQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: heartRateQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: activityMapQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey });
        await router.invalidate();
        if (result.done) {
          setMessage("Strava sync is up to date.");
          return result;
        }
        if (result.pausedUntil) {
          setError(
            `Rate limit reached. Resume after ${new Date(result.pausedUntil).toLocaleString()}. ${result.rateLimit.dailyRemaining} daily reads remain.`,
          );
          return result;
        }
        if (result.lastError) {
          setError(result.lastError);
          return result;
        }
      }
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Sync failed");
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="w-full sm:w-auto"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
        >
          {sync.isPending ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {sync.isPending ? "Syncing" : "Sync from Strava"}
        </Button>
        <Badge variant="secondary">{props.activityCount} activities</Badge>
        {props.status !== "idle" ? (
          <Badge variant={props.status === "paused" ? "warning" : "info"}>{props.status}</Badge>
        ) : null}
        <Badge variant={props.streamsPending ? "warning" : "success"}>
          {props.streamsPending} streams pending
        </Badge>
        {props.shortLimitRemaining != null ? (
          <Badge variant={props.shortLimitRemaining < 20 ? "warning" : "outline"}>
            {props.shortLimitRemaining} reads left this window
          </Badge>
        ) : null}
        {props.dailyLimitRemaining != null ? (
          <Badge variant={props.dailyLimitRemaining < 100 ? "warning" : "outline"}>
            {props.dailyLimitRemaining} reads left today
          </Badge>
        ) : null}
      </div>
      {message ? (
        <p
          className={
            message === "Strava sync is up to date."
              ? "text-success text-sm"
              : "text-muted-foreground text-sm"
          }
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Sync paused</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function SignInPanel() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground max-w-xl text-sm">
        Connect Strava to import every activity and its streams into local Postgres. Rate limits are
        respected automatically.
      </p>
      <Button
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void authClient.signIn
            .social({
              provider: "strava",
              callbackURL: "/",
            })
            .then((result) => {
              if (result.error) {
                setError(
                  result.error.message ??
                    "Strava sign-in failed. Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env.local.",
                );
                setPending(false);
              }
            })
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : "Strava sign-in failed");
              setPending(false);
            });
        }}
      >
        Connect Strava
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not start Strava OAuth</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
