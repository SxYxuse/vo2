"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { RefreshCwIcon } from "lucide-react";

import { useStravaSync } from "@/hooks/use-strava-sync.ts";
import { syncStatusQueryOptions } from "@/lib/queries.ts";
import type { SyncKind, SyncStatus } from "@/services/strava-sync.types.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

function statusBadge(status: SyncKind): {
  label: string;
  variant: "success" | "warning" | "destructive" | "outline";
} {
  if (status === "complete") return { label: "Full success", variant: "success" };
  if (status === "paused") return { label: "Paused", variant: "warning" };
  if (status === "failed") return { label: "Failed", variant: "destructive" };
  if (status === "incomplete") return { label: "Incomplete", variant: "warning" };
  return { label: "Never copied", variant: "outline" };
}

function lastAttemptLabel(iso: string | null) {
  if (!iso) return "No copy has run yet.";
  const at = new Date(iso);
  return `Last attempt ${formatDistanceToNow(at, { addSuffix: true })} · ${at.toLocaleString()}`;
}

function retryLabel(status: SyncKind) {
  if (status === "never" || status === "complete") return "Sync now";
  return "Retry missing data";
}

export function SettingsSyncSection({ enabled }: { enabled: boolean }) {
  const { data, isPending } = useQuery({
    ...syncStatusQueryOptions,
    enabled,
  });
  const sync = useStravaSync();
  const status = data ?? null;
  const pauseActive =
    Boolean(status?.pausedUntil) && new Date(status?.pausedUntil ?? 0).getTime() > Date.now();

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Strava copy</FieldLegend>
        <FieldDescription>
          A full success copies every activity and its streams, including older history still
          missing locally. Retry keeps going until that copy is complete or Strava asks us to pause.
        </FieldDescription>
      </FieldSet>
      {isPending && !status ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <SyncStatusCard
          status={status}
          pauseActive={pauseActive}
          syncing={sync.isPending}
          onRetry={() => sync.mutate()}
        />
      )}
    </FieldGroup>
  );
}

function SyncStatusCard({
  status,
  pauseActive,
  syncing,
  onRetry,
}: {
  status: SyncStatus | null;
  pauseActive: boolean;
  syncing: boolean;
  onRetry: () => void;
}) {
  const kind = status?.status ?? "never";
  const badge = statusBadge(kind);
  const copied = status?.streamsCopied ?? 0;
  const total = status?.activityCount ?? 0;
  const pending = status?.streamsPending ?? 0;
  const filled = total === 0 ? 0 : Math.round((copied / total) * 100);

  return (
    <div className="flex flex-col gap-3">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <RefreshCwIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Local copy</ItemTitle>
          <ItemDescription>{lastAttemptLabel(status?.lastAttemptAt ?? null)}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </ItemActions>
      </Item>
      <Progress value={filled} className="w-full">
        <ProgressLabel>
          {total === 0
            ? "No activities copied yet"
            : `${copied} of ${total} activities have streams${pending > 0 ? ` · ${pending} still to copy` : ""}`}
        </ProgressLabel>
      </Progress>
      {kind === "paused" && status?.pausedUntil ? (
        <Alert variant="warning">
          <AlertTitle>Rate limit reached</AlertTitle>
          <AlertDescription>
            Resume after {new Date(status.pausedUntil).toLocaleString()}.
            {status.dailyLimitRemaining != null
              ? ` ${status.dailyLimitRemaining} daily reads remain.`
              : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {kind === "failed" && status?.lastError ? (
        <Alert variant="destructive">
          <AlertTitle>Last copy failed</AlertTitle>
          <AlertDescription>{status.lastError}</AlertDescription>
        </Alert>
      ) : null}
      {kind === "incomplete" ? (
        <Alert variant="warning">
          <AlertTitle>Copy is not a full success</AlertTitle>
          <AlertDescription>
            Retry pulls newer activities, walks backward for missing history, and fetches streams we
            still do not have.
          </AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" onClick={onRetry} disabled={syncing || pauseActive} aria-busy={syncing}>
        {syncing ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RefreshCwIcon data-icon="inline-start" />
        )}
        {syncing ? "Syncing" : retryLabel(kind)}
      </Button>
    </div>
  );
}
