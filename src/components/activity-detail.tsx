"use client";

import { lazy, Suspense, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ActivityIcon, ChevronLeftIcon, HeartOffIcon } from "lucide-react";

import {
  formatActivitySchedule,
  formatBpm,
  formatDistanceKm,
  formatDuration,
  formatElevation,
  formatLocomotion,
  formatWatts,
  locomotionFor,
  type ActivityDetail,
} from "@/services/activity-detail.ts";
import { formatSportType } from "@/services/calendar-settings.ts";
import { SERIES_META } from "@/components/activity-detail-series.ts";
import { ActivityRideAnalysis } from "@/components/activity-ride-analysis.tsx";
import { isCyclingSport } from "@/services/training-load.ts";
import { weekStartKey } from "@/services/training-plan.ts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
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
          label={locomotionFor(detail.sportType).kpiLabel}
          value={formatLocomotion(detail.kpis.avgSpeed, detail.sportType)}
          color={SERIES_META.speed.color}
        />
      </div>

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
      {detail.ride ? <ActivityRideAnalysis ride={detail.ride} /> : null}
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
        <ActivityAnalysisCard activityId={detail.id} hasStreams={detail.hasStreams} />
      </Suspense>
    </div>
  );
}

/** Returns to the calendar week the activity was opened from, or the activity's own week. */
function CalendarBackLink({ week, start }: { week?: string; start?: string }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentWeek = weekStartKey(new Date(), timeZone);
  const target = week ?? (start ? weekStartKey(new Date(start), timeZone) : currentWeek);
  return (
    <Link
      to="/"
      search={target < currentWeek ? { week: target } : {}}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
    >
      <ChevronLeftIcon />
      Calendar
    </Link>
  );
}

export function ActivityDetailPending({ week }: { week?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <CalendarBackLink week={week} />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-8 w-full max-w-80 rounded-md" />
      <Skeleton className="h-52 w-full rounded-lg sm:h-72" />
    </div>
  );
}

export function ActivityDetailView({
  detail,
  color,
  week,
}: {
  detail: ActivityDetail;
  color?: string;
  week?: string;
}) {
  useEffect(() => {
    void import("@/components/activity-analysis.tsx");
    void import("@/components/activity-analysis-live.tsx");
    void import("@/components/activity-detail-charts.tsx");
  }, []);

  const end = new Date(new Date(detail.start).getTime() + detail.elapsedTime * 1000).toISOString();
  const missingHeartrate = detail.hasStreams && !detail.series.includes("heartrate");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <CalendarBackLink week={week} start={detail.start} />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl">
            {detail.title}
          </h1>
          <Badge variant="outline" className="gap-1.5">
            {color ? (
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: color }}
              />
            ) : null}
            {formatSportType(detail.sportType)}
          </Badge>
          {missingHeartrate ? (
            <Badge variant="warning" className="gap-1.5">
              <HeartOffIcon />
              No heart rate
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">{formatActivitySchedule(detail.start, end)}</p>
      </div>
      <ActivityDetailBody key={detail.id} detail={detail} />
    </div>
  );
}

export function ActivityDetailMissing({ week }: { week?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <CalendarBackLink week={week} />
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ActivityIcon />
          </EmptyMedia>
          <EmptyTitle>Activity not found</EmptyTitle>
          <EmptyDescription>This activity is not in your library.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
