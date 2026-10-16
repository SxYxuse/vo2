"use client";

import { lazy, Suspense, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, FlaskConicalIcon, HeartOffIcon } from "lucide-react";

import {
  formatActivitySchedule,
  formatBpm,
  formatDistanceKm,
  formatDuration,
  formatElevation,
  formatSpeed,
  formatWatts,
  type ActivityDetail,
} from "@/services/activity-detail.ts";
import { formatSportType } from "@/services/calendar-settings.ts";
import { activityDetailQueryOptions } from "@/lib/queries.ts";
import { SERIES_META } from "@/components/activity-detail-series.ts";
import { ActivityTestFlag } from "@/components/activity-test-flag.tsx";
import { isCyclingSport } from "@/services/training-load.ts";
import { isMissingHeartrate, type CalendarActivity } from "@/services/strava-sync.types.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

const ActivityAnalysisCard = lazy(() =>
  import("@/components/activity-analysis.tsx").then((mod) => ({
    default: mod.ActivityAnalysisCard,
  })),
);

const ActivityStreamCharts = lazy(() =>
  import("@/components/activity-detail-charts.tsx").then((mod) => ({
    default: mod.ActivityStreamCharts,
  })),
);

type ActivityDetailDialogProps = {
  activityId: string | null;
  preview?: CalendarActivity | null;
  color?: string;
  onOpenChange: (open: boolean) => void;
};

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card size="sm" className="gap-1 py-3">
      <CardHeader className="px-3">
        <CardDescription className="flex items-center gap-1.5">
          {color ? (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          ) : null}
          {label}
        </CardDescription>
        <CardTitle className="font-mono text-base tabular-nums sm:text-lg">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function ActivityDetailBody({ detail }: { detail: ActivityDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Distance"
          value={formatDistanceKm(detail.distance)}
          color="var(--color-ds-teal-700)"
        />
        <KpiCard
          label="Moving time"
          value={formatDuration(detail.movingTime)}
          color="var(--color-ds-purple-700)"
        />
        <KpiCard
          label="Elevation"
          value={formatElevation(detail.totalElevationGain)}
          color={SERIES_META.altitude.color}
        />
        <KpiCard
          label="Avg HR"
          value={formatBpm(detail.kpis.avgHeartrate)}
          color={SERIES_META.heartrate.color}
        />
        <KpiCard
          label={isCyclingSport(detail.sportType) ? "Avg / NP" : "Avg power"}
          value={
            isCyclingSport(detail.sportType)
              ? `${formatWatts(detail.kpis.avgWatts)} / ${formatWatts(detail.kpis.normalizedWatts)}`
              : formatWatts(detail.kpis.avgWatts)
          }
          color={SERIES_META.watts.color}
        />
        <KpiCard
          label="Avg speed"
          value={formatSpeed(detail.kpis.avgSpeed)}
          color={SERIES_META.speed.color}
        />
      </div>

      <ActivityTestFlag detail={detail} />

      {detail.hasStreams ? (
        <Suspense fallback={<Skeleton className="h-52 w-full rounded-lg sm:h-72" />}>
          <ActivityStreamCharts detail={detail} />
        </Suspense>
      ) : (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ActivityIcon />
            </EmptyMedia>
            <EmptyTitle>No stream data</EmptyTitle>
            <EmptyDescription>
              This activity has no heart rate, power, or elevation samples to chart.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
        <ActivityAnalysisCard activityId={detail.id} hasStreams={detail.hasStreams} />
      </Suspense>
    </div>
  );
}

export function ActivityDetailDialog({
  activityId,
  preview,
  color,
  onOpenChange,
}: ActivityDetailDialogProps) {
  useEffect(() => {
    void import("@/components/activity-analysis.tsx");
    void import("@/components/activity-analysis-live.tsx");
    void import("@/components/activity-detail-charts.tsx");
  }, []);

  const lastActivityId = useRef(activityId);
  const lastPreview = useRef(preview);
  if (activityId) lastActivityId.current = activityId;
  if (preview) lastPreview.current = preview;
  const queryId = activityId ?? lastActivityId.current ?? "";
  const shownPreview = preview ?? lastPreview.current;

  const detailQuery = useQuery({
    ...activityDetailQueryOptions(queryId),
    enabled: Boolean(queryId),
  });
  const detail = detailQuery.data ?? null;
  const loading = Boolean(activityId) && !detail && !detailQuery.isError;
  const error =
    detailQuery.error instanceof Error
      ? detailQuery.error.message
      : detailQuery.isError
        ? "Could not load activity"
        : null;

  const title = detail?.title ?? shownPreview?.title ?? "Activity";
  const sportType = detail?.sportType ?? shownPreview?.sportType;
  const start = detail?.start ?? shownPreview?.start;
  const end =
    shownPreview?.end ??
    (detail
      ? new Date(new Date(detail.start).getTime() + detail.elapsedTime * 1000).toISOString()
      : undefined);
  const missingHeartrate = shownPreview ? isMissingHeartrate(shownPreview) : false;

  return (
    <ResponsiveDialog open={Boolean(activityId)} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex h-[min(52rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 [--drawer-content-height:min(52rem,calc(100dvh-2rem))] sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-xl">
        <ResponsiveDialogHeader className="bg-background shrink-0 border-b px-4 py-3 pe-12 group-data-[swipe-axis=y]/drawer-popup:text-left sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ResponsiveDialogTitle className="min-w-0 truncate text-base">
              {title}
            </ResponsiveDialogTitle>
            {sportType ? (
              <Badge variant="outline" className="gap-1.5">
                {color ? (
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                {formatSportType(sportType)}
              </Badge>
            ) : null}
            {missingHeartrate ? (
              <Badge variant="warning" className="gap-1.5">
                <HeartOffIcon />
                No heart rate
              </Badge>
            ) : null}
            {detail?.fieldTest ? (
              <Badge variant="info" className="gap-1.5">
                <FlaskConicalIcon />
                {detail.fieldTest.title}
              </Badge>
            ) : null}
          </div>
          <ResponsiveDialogDescription>
            {start ? formatActivitySchedule(start, end ?? start) : "Activity streams"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4 [scrollbar-color:rgb(120_120_120/0.4)_transparent] [scrollbar-width:thin]">
          {loading ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {shownPreview ? (
                  <>
                    <KpiCard
                      label="Distance"
                      value={formatDistanceKm(shownPreview.distance)}
                      color="var(--color-ds-teal-700)"
                    />
                    <KpiCard
                      label="Moving time"
                      value={formatDuration(shownPreview.movingTime)}
                      color="var(--color-ds-purple-700)"
                    />
                  </>
                ) : null}
                {Array.from({ length: shownPreview ? 4 : 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-20 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-8 w-full max-w-80 rounded-md" />
              <Skeleton className="h-52 w-full rounded-lg sm:h-72" />
            </div>
          ) : error ? (
            <Empty className="min-h-64 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>Could not load activity</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : detail ? (
            <ActivityDetailBody key={detail.id} detail={detail} />
          ) : (
            <Empty className="min-h-64 border">
              <EmptyHeader>
                <EmptyTitle>Activity not found</EmptyTitle>
                <EmptyDescription>This activity is not in your library.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <ResponsiveDialogFooter className="bg-background shrink-0 border-t px-4 py-3 sm:px-6 sm:py-4">
          <ResponsiveDialogClose render={<Button variant="outline" className="w-full sm:w-auto" />}>
            Close
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
