"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client.ts";
import { useStravaSync } from "@/hooks/use-strava-sync.ts";
import { syncStatusQueryOptions } from "@/lib/queries.ts";
import { summarizeSyncStatus, type SyncTone } from "@/services/strava-sync.types.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const DOT_TONE: Record<SyncTone, string> = {
  ok: "bg-success",
  attention: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

/** Re-renders once a minute so "Synced 3 minutes ago" stays true while the app sits open. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const wake = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return now;
}

export function SyncPanel() {
  const { data: session } = authClient.useSession();
  const sync = useStravaSync();
  const { data: status } = useQuery({ ...syncStatusQueryOptions, enabled: !!session?.user });
  const now = useMinuteClock();

  if (!session?.user) return null;
  const summary = summarizeSyncStatus(status ?? null, now);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground ms-auto min-w-0"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      aria-busy={sync.isPending}
      aria-label={sync.isPending ? "Syncing from Strava" : summary.description}
    >
      {sync.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_TONE[summary.tone])} />
      )}
      <span className="truncate">{sync.isPending ? "Syncing" : summary.label}</span>
      {sync.isPending ? null : <RefreshCwIcon data-icon="inline-end" />}
    </Button>
  );
}

export function SignInPanel({ children }: { children?: ReactNode } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-3">
      {children}
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
                    "Strava sign-in failed. Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env.",
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
