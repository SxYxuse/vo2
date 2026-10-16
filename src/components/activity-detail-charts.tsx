"use client";

import { useId, useMemo, useState, type ComponentProps } from "react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import {
  defaultVisibleSeries,
  formatBpm,
  formatCadence,
  formatElapsedTick,
  formatElevation,
  formatLocomotion,
  formatPaceClock,
  formatWatts,
  locomotionFor,
  STREAM_SERIES,
  type ActivityChartPoint,
  type ActivityDetail,
  type StreamSeriesKey,
} from "@/services/activity-detail.ts";
import { isCyclingSport } from "@/services/training-load.ts";
import {
  chartConfigFor,
  chartRowsFor,
  seriesMetaFor,
  streamAxisPlacement,
  streamSeriesValues,
  streamYAxis,
} from "@/components/activity-detail-series.ts";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ChartLayout = "combined" | "separate";
type ChartRow = ActivityChartPoint & Record<string, number | undefined>;
type SeriesMeta = ReturnType<typeof seriesMetaFor>;

function formatSeriesValue(key: StreamSeriesKey, value: number, sportType: string, unit: string) {
  if (key === "speed") {
    const loco = locomotionFor(sportType);
    if (loco.kind === "pace") return `${formatPaceClock(value)} ${loco.unit}`;
    return `${value.toFixed(1)} ${loco.unit}`;
  }
  if (key === "altitude") return `${value.toFixed(1)} ${unit}`;
  return `${Math.round(value)} ${unit}`;
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
    return `avg ${formatLocomotion(detail.kpis.avgSpeed, detail.sportType)}`;
  }
  return `gain ${formatElevation(detail.totalElevationGain)}`;
}

function StreamTooltip({
  meta,
  sportType,
  ...props
}: ComponentProps<typeof ChartTooltipContent> & { meta: SeriesMeta; sportType: string }) {
  return (
    <ChartTooltipContent
      {...props}
      indicator="line"
      formatter={(value, name, item) => {
        const dataKey = String(item.dataKey ?? "");
        const key = dataKey as StreamSeriesKey;
        const series = meta[key];
        const actual =
          (item.payload?.[dataKey] as number | undefined) ??
          (typeof value === "number" ? value : undefined);
        if (!series) return typeof name === "string" ? name : null;
        return (
          <div className="flex w-full items-center justify-between gap-4">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: series.color }} />
              <span className="text-muted-foreground">{series.label}</span>
            </span>
            <span className="font-mono font-medium tabular-nums">
              {actual == null ? "—" : formatSeriesValue(key, actual, sportType, series.unit)}
            </span>
          </div>
        );
      }}
    />
  );
}

function StreamValueAxis({
  seriesKey,
  sportType,
  yAxisId,
  values,
  orientation = "left",
  hide = false,
}: {
  seriesKey: StreamSeriesKey;
  sportType: string;
  yAxisId: StreamSeriesKey;
  values: readonly number[];
  orientation?: "left" | "right";
  hide?: boolean;
}) {
  const axis = streamYAxis(seriesKey, sportType, values);
  return (
    <YAxis
      yAxisId={yAxisId}
      orientation={orientation}
      hide={hide}
      type="number"
      tickLine={false}
      axisLine={false}
      width={hide ? 0 : axis.reversed ? 44 : 40}
      reversed={axis.reversed}
      domain={[...axis.domain]}
      ticks={axis.ticks}
      interval={axis.ticks ? 0 : undefined}
      allowDataOverflow={axis.allowDataOverflow}
      tickFormatter={(value) => axis.formatTick(Number(value))}
    />
  );
}

function CombinedStreamChart({
  series,
  data,
  sportType,
  meta,
}: {
  series: StreamSeriesKey[];
  data: ChartRow[];
  sportType: string;
  meta: SeriesMeta;
}) {
  const chartConfig = chartConfigFor(sportType);

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full sm:h-72 lg:h-80">
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          tickFormatter={(value) => formatElapsedTick(Number(value))}
        />
        {series.map((key, index) => {
          const placement = streamAxisPlacement(index);
          return (
            <StreamValueAxis
              key={`axis-${key}`}
              seriesKey={key}
              sportType={sportType}
              yAxisId={key}
              values={streamSeriesValues(data, key)}
              orientation={placement.orientation}
              hide={placement.hide}
            />
          );
        })}
        <ChartTooltip
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          content={
            <StreamTooltip
              meta={meta}
              sportType={sportType}
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
              yAxisId={key}
              dataKey={key}
              type="monotone"
              fill={`var(--color-${key})`}
              fillOpacity={0.18}
              stroke={`var(--color-${key})`}
              strokeWidth={1.5}
              name={meta[key].label}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : (
            <Line
              key={key}
              yAxisId={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={1.75}
              dot={false}
              name={meta[key].label}
              isAnimationActive={false}
              connectNulls={false}
            />
          ),
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

function StreamAreaChart({
  seriesKey,
  data,
  sportType,
  meta,
}: {
  seriesKey: StreamSeriesKey;
  data: ChartRow[];
  sportType: string;
  meta: SeriesMeta;
}) {
  const reactId = useId().replace(/:/g, "");
  const gradientId = `fill-${seriesKey}-${reactId}`;
  const series = meta[seriesKey];
  const chartConfig = chartConfigFor(sportType);

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-36 w-full sm:h-40">
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
        <StreamValueAxis
          seriesKey={seriesKey}
          sportType={sportType}
          yAxisId={seriesKey}
          values={streamSeriesValues(data, seriesKey)}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          content={
            <StreamTooltip
              meta={meta}
              sportType={sportType}
              labelFormatter={(value) => formatElapsedTick(Number(value))}
            />
          }
        />
        <Area
          yAxisId={seriesKey}
          dataKey={seriesKey}
          type="monotone"
          fill={`url(#${gradientId})`}
          stroke={`var(--color-${seriesKey})`}
          strokeWidth={1.75}
          name={series.label}
          isAnimationActive={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

export function ActivityStreamCharts({ detail }: { detail: ActivityDetail }) {
  const meta = seriesMetaFor(detail.sportType);
  const chartData = useMemo(
    () => chartRowsFor(detail.chart, detail.sportType),
    [detail.chart, detail.sportType],
  );
  const [visible, setVisible] = useState<string[]>(() => defaultVisibleSeries(detail));
  const [chartLayout, setChartLayout] = useState<ChartLayout>("combined");
  const shown = useMemo(
    () => STREAM_SERIES.filter((key) => detail.series.includes(key) && visible.includes(key)),
    [detail.series, visible],
  );

  return (
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
                style={{ backgroundColor: meta[key].color }}
              />
              {meta[key].shortLabel}
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
                  style={{ backgroundColor: meta[key].color }}
                />
                <span className="text-muted-foreground">{meta[key].label}</span>
                <span className="hidden font-mono tabular-nums sm:inline">
                  {seriesSummary(detail, key)}
                </span>
              </span>
            ))}
          </div>
          <CombinedStreamChart
            series={shown}
            data={chartData}
            sportType={detail.sportType}
            meta={meta}
          />
        </Card>
      ) : (
        shown.map((key) => (
          <Card key={key} size="sm" className="gap-2 py-3">
            <div className="flex flex-col gap-1 px-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: meta[key].color }}
                />
                <CardTitle>{meta[key].label}</CardTitle>
              </div>
              <CardDescription className="font-mono tabular-nums sm:shrink-0">
                {seriesSummary(detail, key)}
              </CardDescription>
            </div>
            <StreamAreaChart
              seriesKey={key}
              data={chartData}
              sportType={detail.sportType}
              meta={meta}
            />
          </Card>
        ))
      )}
    </>
  );
}
