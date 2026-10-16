"use client";

import { useState, type ReactNode } from "react";
import { RefreshCwIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client.ts";
import { useStravaSync } from "@/hooks/use-strava-sync.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SyncPanel() {
  const { data: session } = authClient.useSession();
  const sync = useStravaSync();

  if (!session?.user) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="ms-auto text-muted-foreground"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      aria-busy={sync.isPending}
    >
      {sync.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RefreshCwIcon data-icon="inline-start" />
      )}
      {sync.isPending ? "Syncing" : "Sync from Strava"}
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
