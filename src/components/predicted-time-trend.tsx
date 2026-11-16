"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";

import { runDistanceLabel } from "@/components/best-labels.ts";
import { useDesktopMedia } from "@/components/responsive-dialog.tsx";
import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { TIME_OUT_FILL, TimeOutPattern } from "@/components/time-out-hatch.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrainingPeriod } from "@/hooks/use-training-period.ts";
import { predictedTimeTrendQueryOptions } from "@/lib/queries.ts";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { addDayKey, dayKey } from "@/services/day-key.ts";
import { timeOutsBetween, type TimeOut } from "@/services/time-outs.ts";
import { periodStartMs, type FitnessPeriod } from "@/services/training-load.ts";
import {
  trendChange,
  type PredictedTimeTrend,
  type TrendTarget,
  type TrendWeek,
} from "@/services/training-paces.types.ts";

const CHART_CONFIG = {
  seconds: { label: "Predicted race time", color: "var(--color-ds-purple-700)" },
} satisfies ChartConfig;

/** Weekly points over 7 days or a month would be one or two dots, so those show 12 weeks. */
const SHORTEST_WEEKS = 12;

const DAY_MS = 86_400_000;

const DATE_TICK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const DATE_FULL = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

const TREND_INFO =
  "Each week's point is the Automatic estimate as it stood that week, from your road runs' best efforts in the 16 weeks before it. Older best efforts count about 1 % less each week, so without hard runs the line slowly fades. That is the estimate waiting for a new best effort, not lost fitness.";

const PACES_FROM_NOTE = {
  effort: "a best effort you picked",
  race: "your race result",
} as const;

/** "10 km 44:12 → 43:01 · VDOT 46.1 → 47.4 over 12 weeks", or one week's time and VDOT. */
function headline(metres: number, points: TrendWeek[]) {
  const change = trendChange(points);
  if (!change) return null;
  const { first, last, weeks } = change;
  const distance = runDistanceLabel(metres);
  if (!first) {
    return `${distance} ${formatDuration(last.seconds)} · VDOT ${last.vdot.toFixed(1)}`;
  }
  return `${distance} ${formatDuration(first.seconds)} → ${formatDuration(last.seconds)} · VDOT ${first.vdot.toFixed(1)} → ${last.vdot.toFixed(1)} over ${weeks} week${weeks === 1 ? "" : "s"}`;
}

function subtitle(metres: number, target: TrendTarget) {
  const distance = runDistanceLabel(metres);
  if (target.kind === "goal") return `${distance} · your A goal, ${target.name}`;
  if (target.kind === "unpredicted") {
    return `${distance} · your A goal, ${target.name}, has no predicted race time`;
  }
  return `${distance} · no running goal`;
}

/** About four ticks on whole minutes, or whole multiples of five minutes for long races. */
function minuteTicks(seconds: number[]) {
  if (!seconds.length) return undefined;
  const low = Math.min(...seconds);
  const high = Math.max(...seconds);
  const minutes = Math.max(1, Math.ceil((high - low) / 60 / 4));
  const step = (minutes > 5 ? Math.ceil(minutes / 5) * 5 : minutes) * 60;
  const first = Math.floor(low / step) * step;
  const last = Math.max(Math.ceil(high / step) * step, first + step);
  const ticks: number[] = [];
  for (let tick = first; tick <= last; tick += step) ticks.push(tick);
  return ticks;
}

/** "1h55" past an hour, so the narrow phone axis fits it; "44:00" below. */
function formatTick(seconds: number) {
  if (seconds < 3600) return formatDuration(seconds);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${Math.floor(seconds / 3600)}h${String(minutes).padStart(2, "0")}`;
}

function periodStartKey(period: FitnessPeriod, timeZone: string) {
  const today = dayKey(new Date(), timeZone);
  if (period === "7d" || period === "1m") return addDayKey(today, -SHORTEST_WEEKS * 7);
  const startMs = periodStartMs(period, timeZone);
  return startMs == null ? "" : dayKey(new Date(startMs), timeZone);
}

/** Card on the Fitness page: the Automatic estimate's predicted race time, week by week. */
export function PredictedTimeTrendCard({ timeOuts }: { timeOuts: TimeOut[] }) {
  const { data, isPending, isError } = useQuery(predictedTimeTrendQueryOptions);
  if (isPending) return <Skeleton className="h-72 w-full rounded-lg" />;
  if (isError) {
    return (
      <Empty className="min-h-32 border">
        <EmptyHeader>
          <EmptyTitle>Could not load predicted race time</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return <TrendCard trend={data} timeOuts={timeOuts} />;
}

function TrendCard({ trend, timeOuts }: { trend: PredictedTimeTrend; timeOuts: TimeOut[] }) {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const isDesktop = useDesktopMedia();
  const period = useTrainingPeriod() ?? "7d";
  const points = useMemo(() => {
    const start = periodStartKey(period, timeZone);
    return trend.points
      .filter((point) => point.date >= start)
      .map((point) => ({ ...point, t: Date.parse(`${point.date}T12:00:00Z`) }));
  }, [trend.points, period, timeZone]);
  const timeOutBands = useMemo(() => {
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) return [];
    return timeOutsBetween(timeOuts, first.date, last.date).map(({ timeOut, from, to }) => ({
      timeOut,
      x1: Math.max(Date.parse(`${from}T00:00:00Z`), first.t),
      x2: Math.min(Date.parse(`${to}T00:00:00Z`) + DAY_MS, last.t),
    }));
  }, [timeOuts, points]);
  const tick = period === "1y" || period === "all" ? DATE_YEAR : DATE_TICK;
  const today = points.at(-1)?.date;
  const summary = headline(trend.metres, points);
  const yTicks = useMemo(
    () => minuteTicks(points.flatMap((point) => (point.seconds == null ? [] : [point.seconds]))),
    [points],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1">
          <CardTitle>Predicted race time</CardTitle>
          <InfoTooltip label="About predicted race time">{TREND_INFO}</InfoTooltip>
        </div>
        <CardDescription>{subtitle(trend.metres, trend.target)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!summary ? (
          <Empty className="min-h-32 border">
            <EmptyHeader>
              <EmptyTitle>Run on the road twice to see your predicted time</EmptyTitle>
              <EmptyDescription>
                Two road runs in 16 weeks give the first estimate, then the line fills in week by
                week.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className="font-medium tabular-nums">{summary}</p>
            {trend.pacesFrom === "automatic" ? null : (
              <p className="text-muted-foreground text-xs">
                Your training paces come from {PACES_FROM_NOTE[trend.pacesFrom]}. This chart shows
                the Automatic estimate, so its latest time can differ from the one on Season.
              </p>
            )}
            {isDesktop === null ? (
              <Skeleton className="h-44 w-full rounded-lg sm:h-56" />
            ) : (
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-44 w-full sm:h-56">
                <LineChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <TimeOutPattern />
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={isDesktop ? 48 : 24}
                    tickFormatter={(value) => tick.format(new Date(Number(value)))}
                  />
                  <YAxis
                    dataKey="seconds"
                    reversed
                    ticks={yTicks}
                    domain={yTicks ? [yTicks[0]!, yTicks.at(-1)!] : ["auto", "auto"]}
                    tickLine={false}
                    axisLine={false}
                    width={isDesktop ? 56 : 44}
                    tickFormatter={(value) => formatTick(Number(value))}
                  />
                  {timeOutBands.map((band) => (
                    <ReferenceArea
                      key={band.timeOut.id}
                      x1={band.x1}
                      x2={band.x2}
                      fill={TIME_OUT_FILL}
                      fillOpacity={1}
                      stroke="none"
                    />
                  ))}
                  <ChartTooltip
                    cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_value, payload) => {
                          const week = payload?.[0]?.payload as TrendWeek | undefined;
                          if (!week) return "";
                          return week.date === today
                            ? "Today"
                            : `Week to ${DATE_FULL.format(new Date(`${week.date}T00:00:00Z`))}`;
                        }}
                        formatter={(_value, _name, item) => <TooltipRows week={item.payload} />}
                      />
                    }
                  />
                  <Line
                    dataKey="seconds"
                    type="monotone"
                    stroke="var(--color-seconds)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: "var(--color-seconds)" }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TooltipRows({ week }: { week: TrendWeek }) {
  if (week.seconds == null || week.vdot == null) {
    return <span className="text-muted-foreground">No estimate this week</span>;
  }
  return (
    <div className="grid w-full gap-1">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Predicted race time</span>
        <span className="font-medium tabular-nums">{formatDuration(week.seconds)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">VDOT</span>
        <span className="font-medium tabular-nums">{week.vdot.toFixed(1)}</span>
      </div>
    </div>
  );
}
