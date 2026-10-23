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
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { SERIES_META } from "@/components/activity-detail-series.ts";
import { ActivityHeartAnalysis } from "@/components/activity-heart.tsx";
import { ActivityRideAnalysis } from "@/components/activity-ride-analysis.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { isCyclingSport } from "@/services/training-load.ts";
import { monthKey, type DiarySearch } from "@/services/diary-window.ts";
import type { BestsReturn } from "@/services/personal-bests.ts";
import { weekStartKey } from "@/services/training-plan.types.ts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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

const ESTIMATED_HR_INFO =
  "No heart rate was recorded, so it is the middle value of your most similar sessions of this sport within two months (duration, speed, and date). Training load, fitness, and form use this estimate.";

function ActivityDetailBody({ detail }: { detail: ActivityDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Distance"
          value={formatDistanceKm(detail.distance)}
          color="var(--color-ds-teal-700)"
        />
        <StatCard
          label="Moving time"
          value={formatDuration(detail.movingTime)}
          color="var(--color-ds-purple-700)"
        />
        <StatCard
          label="Elevation"
          value={formatElevation(detail.totalElevationGain)}
          color={SERIES_META.altitude.color}
        />
        {detail.kpis.avgHeartrate == null && detail.estimatedHeartrate != null ? (
          <StatCard
            label="Avg HR"
            value={`~${formatBpm(detail.estimatedHeartrate)}`}
            hint="Estimated"
            info={ESTIMATED_HR_INFO}
            color={SERIES_META.heartrate.color}
          />
        ) : (
          <StatCard
            label="Avg HR"
            value={formatBpm(detail.kpis.avgHeartrate)}
            color={SERIES_META.heartrate.color}
          />
        )}
        <StatCard
          label={isCyclingSport(detail.sportType) ? "Avg / NP" : "Avg power"}
          value={
            isCyclingSport(detail.sportType)
              ? `${formatWatts(detail.kpis.avgWatts)} / ${formatWatts(detail.kpis.normalizedWatts)}`
              : formatWatts(detail.kpis.avgWatts)
          }
          color={SERIES_META.watts.color}
        />
        <StatCard
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
      {detail.heart ? <ActivityHeartAnalysis heart={detail.heart} start={detail.start} /> : null}
      {detail.ride ? <ActivityRideAnalysis ride={detail.ride} /> : null}
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
        <ActivityAnalysisCard activityId={detail.id} hasStreams={detail.hasStreams} />
      </Suspense>
    </div>
  );
}

type ActivitySearch = DiarySearch & BestsReturn;

/**
 * Returns to the bests board or calendar period the activity was opened from, or else the
 * activity's own month and week so either calendar view lands on it.
 */
function BackLink({ diary, start }: { diary?: ActivitySearch; start?: string }) {
  if (diary?.from === "bests") {
    return (
      <Link
        to="/bests"
        search={{ best: diary.best, period: diary.period }}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
      >
        <ChevronLeftIcon />
        Bests
      </Link>
    );
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let search: DiarySearch = {};
  if (diary?.month || diary?.week) {
    search = { month: diary.month, week: diary.week };
  } else if (start) {
    const now = new Date();
    const month = monthKey(new Date(start), timeZone);
    const week = weekStartKey(new Date(start), timeZone);
    search = {
      ...(month < monthKey(now, timeZone) ? { month } : {}),
      ...(week < weekStartKey(now, timeZone) ? { week } : {}),
    };
  }
  return (
    <Link
      to="/"
      search={search}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
    >
      <ChevronLeftIcon />
      Calendar
    </Link>
  );
}

export function ActivityDetailPending({ diary }: { diary?: ActivitySearch }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <BackLink diary={diary} />
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
  diary,
}: {
  detail: ActivityDetail;
  color?: string;
  diary?: ActivitySearch;
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
        <BackLink diary={diary} start={detail.start} />
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

export function ActivityDetailMissing({ diary }: { diary?: ActivitySearch }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <BackLink diary={diary} />
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
