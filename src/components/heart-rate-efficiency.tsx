"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { useDesktopMedia } from "@/hooks/use-desktop-media.ts";
import { fitnessQueryOptions } from "@/lib/queries.ts";
import {
  efficiencyTrendSummary,
  formatEfficiency,
  type EfficiencyWeek,
} from "@/services/heart-insights.ts";
import type { HeartRateSport } from "@/services/heart-rate.ts";
import { buildPmc, type FitnessPeriod } from "@/services/training-load.ts";
import { addDayKey, weekStartKey } from "@/services/day-key.ts";
import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const CHART_CONFIG = {
  ef: { label: "Efficiency", color: "var(--color-ds-red-700)" },
  ctl: { label: "Fitness (CTL)", color: "var(--color-ds-blue-700)" },
} satisfies ChartConfig;

const WEEK_TICK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const EF_INFO =
  "Output per heartbeat on aerobic sessions (below the top of zone 3): normalized power ÷ average heart rate on rides with a power meter, speed ÷ average heart rate on flat runs. A rising line means you do more work for the same heart rate. Plotted as the weekly median next to fitness, so you can see whether the load is turning into aerobic gains.";

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weekLabel(week: string) {
  const [year, month, day] = week.split("-").map(Number);
  return WEEK_TICK.format(new Date(year, month - 1, day));
}

function signed(value: number, digits = 1, unit = "") {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;
}

/** Weekly aerobic efficiency vs fitness for one sport, inside the shared period. */
export function EfficiencyTrendCard({
  sport,
  period,
}: {
  sport: HeartRateSport;
  period: FitnessPeriod;
}) {
  const isDesktop = useDesktopMedia();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const { data: fitness } = useQuery(fitnessQueryOptions);
  const kind = sport.efficiencyKind;

  const weeks = useMemo<EfficiencyWeek[]>(() => {
    const byWeek = new Map<string, number[]>();
    for (const point of sport.efficiency) {
      if (!point.aerobic) continue;
      const week = weekStartKey(new Date(point.start), timeZone);
      byWeek.set(week, [...(byWeek.get(week) ?? []), point.ef]);
    }
    const pmc = fitness?.fitnessLoads.length ? buildPmc(fitness.fitnessLoads, timeZone) : [];
    const ctlByDay = new Map(pmc.map((point) => [point.date, point.ctl]));
    const latest = pmc.at(-1);
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, values]) => {
        const end = addDayKey(week, 6);
        const ctl = ctlByDay.get(end) ?? (latest && latest.date < end ? latest.ctl : null) ?? null;
        return {
          week,
          ef: Math.round(median(values) * 1000) / 1000,
          count: values.length,
          ctl: ctl == null ? null : Math.round(ctl * 10) / 10,
        };
      });
  }, [sport.efficiency, fitness, timeZone]);

  if (!kind) return null;
  const summary = efficiencyTrendSummary(weeks);
  const unit = kind === "power" ? "W/bpm" : "m/min/bpm";

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center gap-1">
          <CardTitle>Aerobic efficiency vs fitness</CardTitle>
          <InfoTooltip label="About aerobic efficiency">{EF_INFO}</InfoTooltip>
        </div>
        <CardDescription>
          {kind === "power"
            ? "Normalized power per heartbeat on easy and steady rides."
            : "Speed per heartbeat on easy and steady flat runs."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {period === "7d" ? (
          <Empty className="min-h-32 border">
            <EmptyHeader>
              <EmptyTitle>Pick a longer period</EmptyTitle>
              <EmptyDescription>
                Efficiency moves over weeks. Choose 1 month or longer to see a trend.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : weeks.length < 2 ? (
          <Empty className="min-h-32 border">
            <EmptyHeader>
              <EmptyTitle>Not enough aerobic sessions</EmptyTitle>
              <EmptyDescription>
                {kind === "power"
                  ? "Needs rides of 20 minutes or more with a power meter and heart rate, in at least two weeks."
                  : "Needs flat outdoor runs of 20 minutes or more with heart rate, in at least two weeks."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {summary ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
                  <span
                    className={cn(
                      summary.efPct >= 2
                        ? "text-success"
                        : summary.efPct <= -2
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  >
                    Efficiency {signed(summary.efPct, 1, " %")}
                  </span>
                  <span className="text-muted-foreground">Fitness {signed(summary.ctlChange)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{summary.text}</p>
              </div>
            ) : null}
            <ChartContainer config={CHART_CONFIG} className="aspect-auto h-52 w-full sm:h-64">
              <ComposedChart data={weeks} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="week"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickFormatter={(value) => weekLabel(String(value))}
                />
                <YAxis
                  yAxisId="ef"
                  domain={["auto", "auto"]}
                  hide={isDesktop !== true}
                  tickLine={false}
                  axisLine={false}
                  width={isDesktop === true ? 40 : 0}
                  tickFormatter={(value) => Number(value).toFixed(2)}
                />
                <YAxis
                  yAxisId="ctl"
                  orientation="right"
                  domain={["auto", "auto"]}
                  hide={isDesktop !== true}
                  tickLine={false}
                  axisLine={false}
                  width={isDesktop === true ? 32 : 0}
                  tickFormatter={(value) => String(Math.round(Number(value)))}
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(_value, payload) => {
                        const row = payload?.[0]?.payload as EfficiencyWeek | undefined;
                        return row
                          ? `Week of ${weekLabel(row.week)} · ${row.count} session${row.count === 1 ? "" : "s"}`
                          : "";
                      }}
                      formatter={(value, name, item) => {
                        const key = String(item.dataKey ?? name) as keyof typeof CHART_CONFIG;
                        const meta = CHART_CONFIG[key];
                        if (!meta || typeof value !== "number") return null;
                        return (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{meta.label}</span>
                            <span className="font-mono font-medium tabular-nums">
                              {key === "ef" ? formatEfficiency(value, kind) : value.toFixed(1)}
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Line
                  yAxisId="ef"
                  dataKey="ef"
                  type="monotone"
                  stroke="var(--color-ef)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="ctl"
                  dataKey="ctl"
                  type="monotone"
                  stroke="var(--color-ctl)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">
              Solid: weekly median efficiency ({unit}). Dashed: fitness at the end of each week.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
