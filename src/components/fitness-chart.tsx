"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { useDesktopMedia } from "@/components/responsive-dialog.tsx";
import { PeriodToggle } from "@/components/period-toggle.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { useTrainingPeriod } from "@/hooks/use-training-period.ts";

import {
  FITNESS_PERIODS,
  averageWeeklyMovingSeconds,
  buildPmc,
  ctlChange,
  formLabel,
  pmcWithCurrentForm,
  roundLoad,
  slicePmc,
  type FitnessLoad,
  type FitnessPeriod,
} from "@/services/training-load.ts";
import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const SERIES_KEYS = ["load", "ctl", "atl", "tsb"] as const;

const CHART_CONFIG = {
  load: { label: "Daily load", color: "var(--color-ds-gray-700)" },
  ctl: { label: "Fitness (CTL)", color: "var(--color-ds-blue-700)" },
  atl: { label: "Fatigue (ATL)", color: "var(--color-ds-amber-700)" },
  tsb: { label: "Form (TSB)", color: "var(--color-ds-green-700)" },
} satisfies ChartConfig;

const SERIES_SHORT_LABEL = {
  load: "Load",
  ctl: "CTL",
  atl: "ATL",
  tsb: "TSB",
} as const;

const SERIES_INFO = {
  ctl: "42-day training load. This is fitness: it climbs with consistent work and fades slowly if you rest. A steady rise over months is the goal.",
  atl: "7-day training load. This is fatigue: it jumps after hard or long days and drops within a few easy days.",
  tsb: "Fitness minus fatigue after that day's known training (today: as of now). Positive means you are fresh. Negative means you are carrying fatigue.",
} as const;

const PMC_Y_DOMAIN = ["auto", "auto"] as const;
const LOAD_Y_DOMAIN = [0, "auto"] as const;

const GRAPH_GOAL_INFO =
  "Use this to keep progressing without digging a hole: raise fitness over weeks, let fatigue come down after hard blocks, and keep quality work in the productive form band (about −10 to +15). Progress looks like a slowly rising fitness line, not a single huge week.";

const RAMP_INFO =
  "How much fitness changed in the last 7 days. A small plus (about +2 to +8) is a productive build. A large plus often means you ramped too fast.";

const AVG_WEEK_INFO =
  "Average moving time per week in the selected period, including rest weeks. Check that volume supports a rising fitness line, not only one big week.";

const ESTIMATED_INFO =
  "Some sessions have no power or heart rate, so their load is guessed from duration. Treat those days as approximate.";

function formatTrainingHmm(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

const DATE_TICK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const DATE_FULL = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formTone(tsb: number) {
  if (tsb >= 5) return "text-success";
  if (tsb >= -10) return "text-muted-foreground";
  if (tsb >= -30) return "text-warning";
  return "text-destructive";
}

function rampTone(ramp: number) {
  if (ramp > 8) return "text-warning";
  if (ramp >= 2) return "text-success";
  if (ramp >= 0) return "text-muted-foreground";
  return "text-destructive";
}

function Sparkline({
  data,
  dataKey,
}: {
  data: Array<{ ctl: number; atl: number; tsb: number }>;
  dataKey: "ctl" | "atl" | "tsb";
}) {
  const rawId = useId();
  const gradientId = `spark-${dataKey}-${rawId.replace(/:/g, "")}`;
  return (
    <ChartContainer
      config={{ [dataKey]: CHART_CONFIG[dataKey] }}
      className="aspect-auto h-8 w-full"
    >
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.4} />
            <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          dataKey={dataKey}
          type="monotone"
          stroke={`var(--color-${dataKey})`}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function FitnessChart({ loads }: { loads: FitnessLoad[] }) {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const isDesktop = useDesktopMedia();
  const sharedPeriod = useTrainingPeriod();
  const [visible, setVisible] = useState<string[]>(() => [...SERIES_KEYS]);
  const period: FitnessPeriod = sharedPeriod ?? "7d";

  const pmc = useMemo(() => (loads.length ? buildPmc(loads, timeZone) : []), [loads, timeZone]);
  const series = useMemo(
    () =>
      pmc.length && isDesktop !== null ? pmcWithCurrentForm(slicePmc(pmc, period, timeZone)) : [],
    [pmc, period, timeZone, isDesktop],
  );
  const latest = series.at(-1);
  const ramp = ctlChange(pmc);
  const estimatedShare =
    series.reduce((sum, point) => sum + point.estimatedLoad, 0) /
    Math.max(
      1,
      series.reduce((sum, point) => sum + point.load, 0),
    );
  const avgWeekSeconds = useMemo(
    () => averageWeeklyMovingSeconds(loads, series, timeZone),
    [loads, series, timeZone],
  );
  const periodLabel = FITNESS_PERIODS.find((item) => item.id === period)?.label ?? "this period";

  const tickFormatter = period === "1y" || period === "all" ? DATE_YEAR : DATE_TICK;
  const showLoad = visible.includes("load");
  const showCtl = visible.includes("ctl");
  const showAtl = visible.includes("atl");
  const showTsb = visible.includes("tsb");
  const showPmc = showCtl || showAtl || showTsb;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="hidden min-w-0 flex-col gap-1 sm:flex">
          <div className="flex items-center gap-1">
            <CardTitle>Fitness and form</CardTitle>
            <InfoTooltip label="About this graph">{GRAPH_GOAL_INFO}</InfoTooltip>
          </div>
          <CardDescription>
            Track fitness, fatigue, and form so you can keep building without overreaching.
          </CardDescription>
        </div>
        <PeriodToggle period={sharedPeriod} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!loads.length ? (
          <Empty className="min-h-48 border">
            <EmptyHeader>
              <EmptyTitle>No training load yet</EmptyTitle>
              <EmptyDescription>
                Import activities to build fitness, fatigue, and form over time.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : isDesktop === null || !latest ? (
          <Skeleton className="h-80 w-full rounded-lg" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard
                label="Fitness (CTL)"
                value={roundLoad(latest.ctl).toFixed(1)}
                info={SERIES_INFO.ctl}
                color={CHART_CONFIG.ctl.color}
                sparkline={
                  isDesktop === true ? undefined : <Sparkline data={series} dataKey="ctl" />
                }
              />
              <StatCard
                label="Fatigue (ATL)"
                value={roundLoad(latest.atl).toFixed(1)}
                info={SERIES_INFO.atl}
                color={CHART_CONFIG.atl.color}
                sparkline={
                  isDesktop === true ? undefined : <Sparkline data={series} dataKey="atl" />
                }
              />
              <StatCard
                label="Form (TSB)"
                value={roundLoad(latest.tsb).toFixed(1)}
                hint={formLabel(latest.tsb)}
                info={SERIES_INFO.tsb}
                color={CHART_CONFIG.tsb.color}
                hintClassName={formTone(latest.tsb)}
                sparkline={
                  isDesktop === true ? undefined : <Sparkline data={series} dataKey="tsb" />
                }
              />
              <StatCard
                label="Ramp (7d)"
                value={`${ramp >= 0 ? "+" : ""}${roundLoad(ramp).toFixed(1)}`}
                info={RAMP_INFO}
                valueClassName={rampTone(ramp)}
              />
              <StatCard
                label="Avg week"
                value={formatTrainingHmm(avgWeekSeconds)}
                hint={period === "all" ? "all time" : `over ${periodLabel}`}
                info={AVG_WEEK_INFO}
                color="var(--color-ds-teal-700)"
              />
            </div>
            {estimatedShare > 0.05 ? (
              <Badge variant="info" className="w-fit gap-1">
                {Math.round(estimatedShare * 100)}% of load in this period is duration-estimated
                <InfoTooltip label="About estimated load">{ESTIMATED_INFO}</InfoTooltip>
              </Badge>
            ) : null}
            <ToggleGroup
              multiple
              size="sm"
              variant="outline"
              spacing={0}
              value={visible}
              onValueChange={setVisible}
              className="flex-wrap"
            >
              {SERIES_KEYS.map((key) => (
                <ToggleGroupItem key={key} value={key}>
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: CHART_CONFIG[key].color }}
                  />
                  <span className="sm:hidden">{SERIES_SHORT_LABEL[key]}</span>
                  <span className="hidden sm:inline">{CHART_CONFIG[key].label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {showLoad || showPmc ? (
              <ChartContainer
                config={CHART_CONFIG}
                className="aspect-auto h-44 w-full sm:h-72 lg:h-80"
              >
                <ComposedChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={isDesktop === true ? 48 : 24}
                    tickFormatter={(value) => tickFormatter.format(new Date(Number(value)))}
                  />
                  {showPmc ? (
                    <YAxis
                      yAxisId="pmc"
                      type="number"
                      domain={PMC_Y_DOMAIN}
                      hide={isDesktop !== true}
                      tickLine={false}
                      axisLine={false}
                      width={isDesktop === true ? 40 : 0}
                      tickFormatter={(value) => String(Math.round(Number(value)))}
                    />
                  ) : null}
                  {showLoad ? (
                    <YAxis
                      yAxisId="load"
                      type="number"
                      domain={LOAD_Y_DOMAIN}
                      hide={isDesktop !== true}
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      width={isDesktop === true ? 36 : 0}
                      tickFormatter={(value) => String(Math.round(Number(value)))}
                    />
                  ) : null}
                  {showPmc ? (
                    <ReferenceLine yAxisId="pmc" y={0} stroke="var(--color-border)" />
                  ) : null}
                  <ChartTooltip
                    cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                    content={
                      <ChartTooltipContent
                        indicator="line"
                        labelFormatter={(_value, payload) => {
                          const stamp = Number(payload?.[0]?.payload?.t);
                          return Number.isFinite(stamp) ? DATE_FULL.format(new Date(stamp)) : "";
                        }}
                        formatter={(value, name, item) => {
                          const key = String(item.dataKey ?? name);
                          const meta = CHART_CONFIG[key as keyof typeof CHART_CONFIG];
                          if (!meta || typeof value !== "number") return null;
                          const extra =
                            key === "load" && item.payload?.estimatedLoad
                              ? ` (${Math.round((Number(item.payload.estimatedLoad) / Math.max(value, 0.1)) * 100)}% est.)`
                              : "";
                          return (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">{meta.label}</span>
                              <span className="font-mono font-medium tabular-nums">
                                {roundLoad(value).toFixed(1)}
                                {extra}
                              </span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  {showLoad ? (
                    <Bar
                      yAxisId="load"
                      dataKey="load"
                      name={CHART_CONFIG.load.label}
                      fill="var(--color-load)"
                      fillOpacity={0.28}
                      radius={1}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {showCtl ? (
                    <Line
                      yAxisId="pmc"
                      dataKey="ctl"
                      type="monotone"
                      name={CHART_CONFIG.ctl.label}
                      stroke="var(--color-ctl)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {showAtl ? (
                    <Line
                      yAxisId="pmc"
                      dataKey="atl"
                      type="monotone"
                      name={CHART_CONFIG.atl.label}
                      stroke="var(--color-atl)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {showTsb ? (
                    <Line
                      yAxisId="pmc"
                      dataKey="tsb"
                      type="monotone"
                      name={CHART_CONFIG.tsb.label}
                      stroke="var(--color-tsb)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                </ComposedChart>
              </ChartContainer>
            ) : (
              <Empty className="min-h-48 border">
                <EmptyHeader>
                  <EmptyTitle>No series selected</EmptyTitle>
                  <EmptyDescription>
                    Turn a metric back on to plot load, fitness, fatigue, or form.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
