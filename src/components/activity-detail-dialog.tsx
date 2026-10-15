"use client";

import { lazy, Suspense, useId, useMemo, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, FlaskConicalIcon, HeartOffIcon } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import {
  formatActivitySchedule,
  formatBpm,
  formatCadence,
  formatDistanceKm,
  formatDuration,
  formatElapsedTick,
  formatElevation,
  formatSpeed,
  formatWatts,
  STREAM_SERIES,
  type ActivityChartPoint,
  type ActivityDetail,
  type StreamSeriesKey,
} from "#/services/activity-detail.ts";
import { formatSportType } from "#/services/calendar-settings.ts";
import { activityDetailQueryOptions } from "#/lib/queries.ts";
import { ActivityTestFlag } from "#/components/activity-test-flag.tsx";
import { sportGroupFor } from "#/services/sport-groups.ts";
import { isCyclingSport } from "#/services/training-load.ts";
import { isMissingHeartrate, type CalendarActivity } from "#/services/strava-sync.types.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const ActivityAnalysisCard = lazy(() =>
  import("#/components/activity-analysis.tsx").then((mod) => ({
    default: mod.ActivityAnalysisCard,
  })),
);

const SERIES_META: Record<
  StreamSeriesKey,
  { label: string; shortLabel: string; unit: string; color: string }
> = {
  heartrate: {
    label: "Heart rate",
    shortLabel: "HR",
    unit: "bpm",
    color: "var(--color-ds-red-700)",
  },
  watts: {
    label: "Power",
    shortLabel: "Power",
    unit: "W",
    color: "var(--color-ds-amber-700)",
  },
  cadence: {
    label: "Cadence",
    shortLabel: "Cadence",
    unit: "rpm",
    color: "var(--color-ds-purple-700)",
  },
  speed: {
    label: "Speed",
    shortLabel: "Speed",
    unit: "km/h",
    color: "var(--color-ds-blue-700)",
  },
  altitude: {
    label: "Elevation",
    shortLabel: "Elev",
    unit: "m",
    color: "var(--color-ds-green-700)",
  },
};

const CHART_CONFIG = Object.fromEntries(
  STREAM_SERIES.map((key) => [
    key,
    { label: SERIES_META[key].label, color: SERIES_META[key].color },
  ]),
) satisfies ChartConfig;

type ChartLayout = "combined" | "separate";
type ChartRow = ActivityChartPoint & Record<string, number | undefined>;

function defaultVisibleSeries(detail: ActivityDetail) {
  const offByDefault = new Set<StreamSeriesKey>(["cadence", "speed"]);
  if (sportGroupFor(detail.sportType)?.id === "running") {
    offByDefault.add("watts");
  }
  return detail.series.filter((key) => !offByDefault.has(key));
}

function formatSeriesValue(key: StreamSeriesKey, value: number) {
  if (key === "speed" || key === "altitude") return value.toFixed(1);
  return String(Math.round(value));
}

function numericValues(data: ChartRow[], keys: string[]) {
  const values: number[] = [];
  for (const point of data) {
    for (const key of keys) {
      const value = point[key];
      if (typeof value === "number") values.push(value);
    }
  }
  return values;
}

function seriesRange(data: ChartRow[], key: StreamSeriesKey) {
  const values = numericValues(data, [key]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  return { min, max: max === min ? min + 1 : max };
}

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

function seriesSummary(detail: ActivityDetail, key: StreamSeriesKey) {
  if (key === "heartrate") {
    return `avg ${formatBpm(detail.kpis.avgHeartrate)} · max ${formatBpm(detail.kpis.maxHeartrate)}`;
  }
  if (key === "watts") {
    const np =
      isCyclingSport(detail.sportType) && detail.kpis.normalizedWatts
        ? ` · NP ${formatWatts(detail.kpis.normalizedWatts)}`
        : "";
    return `avg ${formatWatts(detail.kpis.avgWatts)}${np} · max ${formatWatts(detail.kpis.maxWatts)}`;
  }
  if (key === "cadence") {
    return `avg ${formatCadence(detail.kpis.avgCadence)}`;
  }
  if (key === "speed") {
    return `avg ${formatSpeed(detail.kpis.avgSpeed)}`;
  }
  return `gain ${formatElevation(detail.totalElevationGain)}`;
}

function StreamTooltip(props: ComponentProps<typeof ChartTooltipContent>) {
  return (
    <ChartTooltipContent
      {...props}
      indicator="line"
      formatter={(value, name, item) => {
        const dataKey = String(item.dataKey ?? "").replace(/N$/, "");
        const key = dataKey as StreamSeriesKey;
        const meta = SERIES_META[key];
        const actual =
          (item.payload?.[dataKey] as number | undefined) ??
          (typeof value === "number" ? value : undefined);
        if (!meta) return typeof name === "string" ? name : null;
        return (
          <div className="flex w-full items-center justify-between gap-4">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: meta.color }} />
              <span className="text-muted-foreground">{meta.label}</span>
            </span>
            <span className="font-mono font-medium tabular-nums">
              {actual == null ? "—" : `${formatSeriesValue(key, actual)} ${meta.unit}`}
            </span>
          </div>
        );
      }}
    />
  );
}

function CombinedStreamChart({ series, data }: { series: StreamSeriesKey[]; data: ChartRow[] }) {
  const normalized = series.length > 1;
  const chartData = useMemo(() => {
    if (!normalized) return data;
    const ranges = Object.fromEntries(series.map((key) => [key, seriesRange(data, key)])) as Record<
      StreamSeriesKey,
      { min: number; max: number }
    >;

    return data.map((point) => {
      const next: ChartRow = { ...point };
      for (const key of series) {
        const range = ranges[key];
        const value = point[key];
        next[`${key}N`] =
          value == null ? undefined : ((value - range.min) / (range.max - range.min)) * 100;
      }
      return next;
    });
  }, [data, normalized, series]);

  return (
    <ChartContainer config={CHART_CONFIG} className="aspect-auto h-52 w-full sm:h-72 lg:h-80">
      <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickFormatter={(value) => formatElapsedTick(Number(value))}
        />
        <YAxis
          hide={normalized}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(value) => String(Math.round(Number(value)))}
          domain={series[0] === "altitude" ? ["auto", "auto"] : [0, "auto"]}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          content={
            <StreamTooltip
              labelFormatter={(_value, payload) => {
                const elapsed = Number(payload?.[0]?.payload?.t);
                return formatElapsedTick(elapsed);
              }}
            />
          }
        />
        {series.map((key) =>
          key === "altitude" ? (
            <Area
              key={key}
              dataKey={normalized ? `${key}N` : key}
              type="monotone"
              fill={`var(--color-${key})`}
              fillOpacity={0.18}
              stroke={`var(--color-${key})`}
              strokeWidth={1.5}
              name={SERIES_META[key].label}
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={key}
              dataKey={normalized ? `${key}N` : key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={1.75}
              dot={false}
              name={SERIES_META[key].label}
              isAnimationActive={false}
            />
          ),
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

function StreamAreaChart({ seriesKey, data }: { seriesKey: StreamSeriesKey; data: ChartRow[] }) {
  const reactId = useId().replace(/:/g, "");
  const gradientId = `fill-${seriesKey}-${reactId}`;
  const meta = SERIES_META[seriesKey];

  return (
    <ChartContainer config={CHART_CONFIG} className="aspect-auto h-36 w-full sm:h-40">
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={`var(--color-${seriesKey})`} stopOpacity={0.45} />
            <stop offset="95%" stopColor={`var(--color-${seriesKey})`} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickFormatter={(value) => formatElapsedTick(Number(value))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(value) => String(Math.round(Number(value)))}
          domain={seriesKey === "altitude" ? ["auto", "auto"] : [0, "auto"]}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          content={<StreamTooltip labelFormatter={(value) => formatElapsedTick(Number(value))} />}
        />
        <Area
          dataKey={seriesKey}
          type="monotone"
          fill={`url(#${gradientId})`}
          stroke={`var(--color-${seriesKey})`}
          strokeWidth={1.75}
          name={meta.label}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function ActivityDetailBody({ detail }: { detail: ActivityDetail }) {
  const [visible, setVisible] = useState<string[]>(() => defaultVisibleSeries(detail));
  const [chartLayout, setChartLayout] = useState<ChartLayout>("combined");
  const shown = useMemo(
    () => STREAM_SERIES.filter((key) => detail.series.includes(key) && visible.includes(key)),
    [detail.series, visible],
  );

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
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <ToggleGroup
              multiple
              size="sm"
              variant="outline"
              spacing={0}
              value={visible}
              onValueChange={setVisible}
              className="flex-wrap"
            >
              {detail.series.map((key) => (
                <ToggleGroupItem key={key} value={key}>
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: SERIES_META[key].color }}
                  />
                  {SERIES_META[key].shortLabel}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={0}
              value={[chartLayout]}
              onValueChange={(next) => {
                const mode = next[0];
                if (mode === "combined" || mode === "separate") {
                  setChartLayout(mode);
                }
              }}
            >
              <ToggleGroupItem value="combined">Combined</ToggleGroupItem>
              <ToggleGroupItem value="separate">Separate</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {shown.length === 0 ? (
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyTitle>No streams selected</EmptyTitle>
                <EmptyDescription>
                  Turn a metric back on to plot it against elapsed time.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : chartLayout === "combined" ? (
            <Card size="sm" className="gap-2 py-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 sm:px-4">
                {shown.map((key) => (
                  <span key={key} className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SERIES_META[key].color }}
                    />
                    <span className="text-muted-foreground">{SERIES_META[key].label}</span>
                    <span className="hidden font-mono tabular-nums sm:inline">
                      {seriesSummary(detail, key)}
                    </span>
                  </span>
                ))}
              </div>
              <CombinedStreamChart series={shown} data={detail.chart} />
            </Card>
          ) : (
            shown.map((key) => (
              <Card key={key} size="sm" className="gap-2 py-3">
                <div className="flex flex-col gap-1 px-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: SERIES_META[key].color }}
                    />
                    <CardTitle>{SERIES_META[key].label}</CardTitle>
                  </div>
                  <CardDescription className="font-mono tabular-nums sm:shrink-0">
                    {seriesSummary(detail, key)}
                  </CardDescription>
                </div>
                <StreamAreaChart seriesKey={key} data={detail.chart} />
              </Card>
            ))
          )}
        </>
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
  const detailQuery = useQuery({
    ...activityDetailQueryOptions(activityId ?? ""),
    enabled: Boolean(activityId),
  });
  const detail = detailQuery.data ?? null;
  const loading = detailQuery.isPending;
  const error =
    detailQuery.error instanceof Error
      ? detailQuery.error.message
      : detailQuery.isError
        ? "Could not load activity"
        : null;

  const title = detail?.title ?? preview?.title ?? "Activity";
  const sportType = detail?.sportType ?? preview?.sportType;
  const start = detail?.start ?? preview?.start;
  const end =
    preview?.end ??
    (detail
      ? new Date(new Date(detail.start).getTime() + detail.elapsedTime * 1000).toISOString()
      : undefined);
  const missingHeartrate = preview ? isMissingHeartrate(preview) : false;

  return (
    <Dialog open={Boolean(activityId)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-xl">
        <DialogHeader className="bg-background shrink-0 border-b px-4 py-3 pe-12 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DialogTitle className="min-w-0 truncate text-base">{title}</DialogTitle>
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
          <DialogDescription>
            {start ? formatActivitySchedule(start, end ?? start) : "Activity streams"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4 [scrollbar-color:rgb(120_120_120/0.4)_transparent] [scrollbar-width:thin]">
          {loading ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, index) => (
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

        <DialogFooter className="bg-background shrink-0 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <DialogClose render={<Button variant="outline" className="w-full sm:w-auto" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
