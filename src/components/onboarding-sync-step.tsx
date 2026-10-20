"use client";

import {
  CheckIcon,
  PauseIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import type { OnboardingSyncPhase, OnboardingSyncStep } from "@/services/onboarding-sync.ts";
import type { SyncStatus } from "@/services/strava-sync.types.ts";
import { cn } from "cn";
import { syncKindBadge } from "@/components/settings-sync-section.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function pauseLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PHASE_STYLE: Record<
  OnboardingSyncPhase,
  { stroke: string; icon: { Icon: LucideIcon; className: string } | null }
> = {
  never: { stroke: "stroke-primary", icon: null },
  incomplete: { stroke: "stroke-primary", icon: null },
  syncing: { stroke: "stroke-primary", icon: null },
  complete: { stroke: "stroke-success", icon: { Icon: CheckIcon, className: "text-success" } },
  paused: { stroke: "stroke-warning", icon: { Icon: PauseIcon, className: "text-warning" } },
  failed: {
    stroke: "stroke-destructive",
    icon: { Icon: TriangleAlertIcon, className: "text-destructive" },
  },
};

function statusLine(step: OnboardingSyncStep, status: SyncStatus | null, error: string | null) {
  const count = status?.activityCount ?? 0;
  switch (step.phase) {
    case "syncing":
      if (count === 0) return "Copying your latest activities…";
      return "Found your latest training. Older history and streams keep copying in the background, so you can continue.";
    case "complete":
      return "All caught up. Every activity and stream is copied.";
    case "paused":
      return status?.pausedUntil && step.action === null
        ? `Strava's rate limit paused the copy until ${pauseLabel(status.pausedUntil)}. You can continue now; the rest copies on its own after that.`
        : "Strava's rate limit paused the copy. You can continue now; the rest copies on its own after that.";
    case "failed":
      return (
        error ?? status?.lastError ?? "The copy was interrupted. Retry, or continue and sync later."
      );
    case "incomplete":
      return count > 0
        ? "Found your latest training. The rest of your history copies in the background while VO2 is open."
        : "Part of your history is already copied. Sync to pick up the rest.";
    case "never":
      return "Copy your Strava activities so fitness, form, and your weekly hours start from real training.";
  }
}

function actionLabel(step: OnboardingSyncStep) {
  if (step.action === "retry") return "Retry sync";
  if (step.action === "sync") return "Sync from Strava";
  return "Start sync";
}

export function OnboardingSyncStepPanel({
  step,
  status,
  error,
  onSync,
}: {
  step: OnboardingSyncStep;
  status: SyncStatus | null;
  error: string | null;
  onSync: () => void;
}) {
  const activities = status?.activityCount ?? 0;
  // The ring tracks the gate, not streams: it fills once the newest page is in (ADR 0012).
  const fraction = step.phase === "complete" || activities > 0 ? 1 : 0;
  const syncing = step.phase === "syncing";
  const badge =
    step.phase === "syncing"
      ? { label: "Syncing", variant: "outline" as const }
      : syncKindBadge(step.phase);
  const style = PHASE_STYLE[step.phase];

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="relative size-40">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="8"
            className="stroke-muted"
          />
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
            className={cn("transition-[stroke-dashoffset] duration-700 ease-out", style.stroke)}
          />
        </svg>
        {syncing ? (
          <svg
            viewBox="0 0 120 120"
            className="absolute inset-0 size-full animate-spin [animation-duration:2.4s]"
            aria-hidden="true"
          >
            <circle
              cx="60"
              cy="60"
              r={RING_RADIUS + 7}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${RING_CIRCUMFERENCE * 0.15} ${RING_CIRCUMFERENCE}`}
              className="stroke-primary/40"
            />
          </svg>
        ) : null}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {style.icon ? (
            <style.icon.Icon
              className={cn("mb-0.5 size-5", style.icon.className)}
              aria-hidden="true"
            />
          ) : null}
          <span className="text-3xl font-semibold tabular-nums tracking-tight">{activities}</span>
          <span className="text-muted-foreground text-xs">
            {activities === 1 ? "activity" : "activities"}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2" aria-live="polite">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <p className="text-muted-foreground max-w-sm text-sm">{statusLine(step, status, error)}</p>
      </div>
      {step.action ? (
        <Button type="button" variant="outline" onClick={onSync}>
          <RefreshCwIcon data-icon="inline-start" />
          {actionLabel(step)}
        </Button>
      ) : syncing ? (
        <Button type="button" variant="outline" disabled aria-busy>
          <Spinner data-icon="inline-start" />
          Syncing
        </Button>
      ) : null}
    </div>
  );
}
