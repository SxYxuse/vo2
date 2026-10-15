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
import { Button } from "@/components/ui/button";

export function SyncPanel() {
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const sync = useMutation({
    mutationFn: async () => {
      setError(null);
      while (true) {
        const result = await syncStrava();
        await queryClient.invalidateQueries({ queryKey: appShellQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: heartRateQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: activityMapQueryOptions.queryKey });
        await queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey });
        await router.invalidate();
        if (result.done) return result;
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

  if (!session?.user) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="ms-auto text-muted-foreground"
      title={error ?? undefined}
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
  );
}

export function SignInPanel({ description = true }: { description?: boolean } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-3">
      {description ? (
        <p className="text-muted-foreground max-w-xl text-sm">
          Connect Strava to import every activity and its streams into local Postgres. Rate limits
          are respected automatically.
        </p>
      ) : null}
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
