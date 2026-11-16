"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { runDistanceLabel } from "@/components/best-labels.ts";
import { useDesktopMedia } from "@/components/responsive-dialog.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrainingPeriod } from "@/hooks/use-training-period.ts";
import { predictedTimeTrendQueryOptions } from "@/lib/queries.ts";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { addDayKey, dayKey } from "@/services/day-key.ts";
import { periodStartMs, type FitnessPeriod } from "@/services/training-load.ts";
import type { PredictedTimeTrend, TrendTarget } from "@/services/training-paces.types.ts";

const CHART_CONFIG = {
  seconds: { label: "Predicted race time", color: "var(--color-ds-purple-700)" },
} satisfies ChartConfig;

/** Weekly points over 7 days or a month would be one or two dots, so those show 12 weeks. */
const SHORTEST_WEEKS = 12;

const DATE_TICK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });

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
export function PredictedTimeTrendCard() {
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
  return <TrendCard trend={data} />;
}

function TrendCard({ trend }: { trend: PredictedTimeTrend }) {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const isDesktop = useDesktopMedia();
  const period = useTrainingPeriod() ?? "7d";
  const points = useMemo(() => {
    const start = periodStartKey(period, timeZone);
    return trend.points
      .filter((point) => point.date >= start)
      .map((point) => ({ ...point, t: Date.parse(`${point.date}T12:00:00Z`) }));
  }, [trend.points, period, timeZone]);
  const tick = period === "1y" || period === "all" ? DATE_YEAR : DATE_TICK;
  const yTicks = useMemo(
    () => minuteTicks(points.flatMap((point) => (point.seconds == null ? [] : [point.seconds]))),
    [points],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Predicted race time</CardTitle>
        <CardDescription>{subtitle(trend.metres, trend.target)}</CardDescription>
      </CardHeader>
      <CardContent>
        {isDesktop === null ? (
          <Skeleton className="h-44 w-full rounded-lg sm:h-56" />
        ) : (
          <ChartContainer config={CHART_CONFIG} className="aspect-auto h-44 w-full sm:h-56">
            <LineChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
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
      </CardContent>
    </Card>
  );
}
