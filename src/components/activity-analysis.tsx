"use client";

import { lazy, Suspense, useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { SparklesIcon } from "lucide-react";

import { activityAnalysisQueryOptions } from "@/lib/queries.ts";
import { coachModelLabel } from "@/services/coach-models.ts";
import { CoachWriteup } from "@/components/activity-analysis-writeup.tsx";
import { CoachKeyPrompt, useCoachAvailable } from "@/components/coach-key.tsx";
import { Badge } from "@/components/ui/badge";
import { useOnline } from "@/hooks/use-online.ts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

const ActivityAnalysisLive = lazy(() =>
  import("@/components/activity-analysis-live.tsx").then((mod) => ({
    default: mod.ActivityAnalysisLive,
  })),
);

export function preloadActivityAnalysis() {
  void import("@/components/activity-analysis-live.tsx");
}

export function ActivityAnalysisCard({
  activityId,
  hasStreams,
}: {
  activityId: string;
  hasStreams: boolean;
}) {
  const online = useOnline();
  const coach = useCoachAvailable();
  const savedQuery = useQuery({
    ...activityAnalysisQueryOptions(activityId),
    enabled: Boolean(activityId),
  });
  const [runId, setRunId] = useState<number | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const onBusyChange = useCallback((busy: boolean) => setLiveBusy(busy), []);

  const saved = savedQuery.data;
  const mocked = saved?.mocked ?? coach.mocked;
  const isLoading = liveBusy;
  // Saved analyses stay readable without a key; only a new one needs it (ADR 0036).
  const { needsKey } = coach;

  return (
    <Card aria-busy={isLoading}>
      <CardHeader className="border-b">
        <CardTitle className={isLoading ? "shimmer" : undefined}>
          {isLoading ? "Analyzing" : "Activity analysis"}
        </CardTitle>
        <CardDescription>
          {isLoading
            ? "Working through stream tools, then writing the coach note."
            : saved
              ? `${saved.model ? `By ${coachModelLabel(saved.model)}, saved` : "Saved"} ${formatDistanceToNow(new Date(saved.updatedAt), { addSuffix: true })}. Run again only if you want a fresh read.`
              : "Coach note of intensity, pacing, and terrain. Runs only when you ask."}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {mocked ? <Badge variant="warning">Mocked</Badge> : null}
          {isLoading || needsKey ? null : (
            <Button
              disabled={!hasStreams || !online}
              onMouseEnter={preloadActivityAnalysis}
              onFocus={preloadActivityAnalysis}
              onClick={() => setRunId((current) => (current ?? 0) + 1)}
            >
              <SparklesIcon data-icon="inline-start" />
              {saved ? "Analyze again" : "Analyze"}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasStreams ? (
          <Empty className="min-h-36 border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon className="text-ds-purple-700" />
              </EmptyMedia>
              <EmptyTitle>No streams to analyze</EmptyTitle>
              <EmptyDescription>
                This activity has no elevation, heart rate, or speed samples for the tools to read.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : savedQuery.isPending && runId == null ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : runId != null ? (
          <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
            <ActivityAnalysisLive key={runId} activityId={activityId} onBusyChange={onBusyChange} />
          </Suspense>
        ) : saved?.body ? (
          <CoachWriteup markdown={saved.body} />
        ) : needsKey ? (
          <CoachKeyPrompt>
            The coach analyzes activities on your own OpenRouter key. Add it once to use it.
          </CoachKeyPrompt>
        ) : (
          <Empty className="min-h-36 border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon className="text-ds-purple-700" />
              </EmptyMedia>
              <EmptyTitle>Waiting for you</EmptyTitle>
              <EmptyDescription>
                Analyze writes a coach note from streams and keeps it on this activity until you run
                it again.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
