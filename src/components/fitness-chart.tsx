"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "cn";
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
  trainingPhase,
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
  ctl: "About six weeks of training load: how much training your body is used to. It is not a score of how good you are. It rises in build blocks and dips in recovery weeks, even while you get faster, so it does not need a record every week.",
  atl: "About one week of training load. This is fatigue: it jumps after hard or long days and drops within a few easy days.",
  tsb: "Fitness minus fatigue after that day's known training (today: as of now). Around −10 to −30 is normal while building; positive means fresh, which is what you want before a race or a hard test. It is not a performance score.",
} as const;

const PMC_Y_DOMAIN = ["auto", "auto"] as const;
/** A colour no series uses, so estimated days stand out on any line. */
const ESTIMATED_DOT_COLOR = "var(--color-ds-pink-700)";

type EstimatedDotProps = {
  cx?: number;
  cy?: number;
  payload?: { estimatedLoad?: number };
};

/** Marks a day whose load is partly estimated, on whichever line carries the marks. */
function EstimatedDot({ cx, cy, payload }: EstimatedDotProps) {
  if (cx == null || cy == null || !payload?.estimatedLoad) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={ESTIMATED_DOT_COLOR}
      stroke="var(--color-background)"
      strokeWidth={1.5}
    />
  );
}
const LOAD_Y_DOMAIN = [0, "auto"] as const;

const GRAPH_GOAL_INFO =
  "This graph shows training load, not ability. Use it to dose your training: build fitness in blocks while you recover well, ease off so fatigue clears, and arrive fresh when it matters. Whether you are actually getting better shows in Progress below: your best efforts and your output at the same heart rate.";

const RAMP_INFO =
  "How much fitness changed in the last 7 days. A small plus (about +2 to +8) is a productive build, a large plus often means you ramped too fast, and a minus is a recovery week or a break.";

const AVG_WEEK_INFO = "Average moving time per week in the selected period, including rest weeks.";

const ESTIMATED_INFO =
  "Some sessions have no power or heart rate. Their heart rate is borrowed from your most similar sessions of that sport within two months, or their load is guessed from duration when there are fewer than three. Dots on the graph mark those days; treat them as approximate.";

function formatTrainingHmm(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

const DATE_TICK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const DATE_FULL = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

// Form between −10 and −30 is ordinary training, not a warning.
function formTone(tsb: number) {
  if (tsb >= 5) return "text-success";
  if (tsb >= -30) return "text-muted-foreground";
  return "text-destructive";
}

// Same tints as the success and warning badges.
const PHASE_TONE = {
  positive: { box: "border-success/25 bg-success/10", title: "text-success" },
  neutral: { box: "border-border bg-muted/40", title: "" },
  warning: { box: "border-warning/25 bg-warning/10", title: "text-warning" },
} as const;

const PHASE_INFO =
  "Read from the last week's change in fitness, the trend over four weeks, and form. Training moves through phases: build while you absorb the load, consolidate, recover, then freshen up before a goal. A dipping fitness line in a recovery week is part of the plan.";

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
  const phase = useMemo(() => trainingPhase(pmc), [pmc]);
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
  // One line carries the estimate marks, so they never stack: fitness first.
  const markedLine = showCtl ? "ctl" : showAtl ? "atl" : showTsb ? "tsb" : null;
  const hasEstimatedDays = series.some((point) => point.estimatedLoad > 0);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="hidden min-w-0 flex-col gap-1 sm:flex">
          <div className="flex items-center gap-1">
            <CardTitle>Fitness and form</CardTitle>
            <InfoTooltip label="About this graph">{GRAPH_GOAL_INFO}</InfoTooltip>
          </div>
          <CardDescription>
            How much training you are absorbing, and whether you are fresh. Load, not ability.
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
            <div
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3",
                PHASE_TONE[phase.tone].box,
              )}
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn("text-xs", PHASE_TONE[phase.tone].title || "text-muted-foreground")}
                >
                  Right now
                </span>
                <InfoTooltip
                  label="About the training phase"
                  iconClassName={PHASE_TONE[phase.tone].title || "text-muted-foreground"}
                >
                  {PHASE_INFO}
                </InfoTooltip>
              </div>
              <p className={cn("font-medium", PHASE_TONE[phase.tone].title)}>{phase.title}</p>
              <p className={cn("text-sm", PHASE_TONE[phase.tone].title || "text-muted-foreground")}>
                {phase.detail}
              </p>
            </div>
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
                {Math.round(estimatedShare * 100)}% of load in this period is estimated
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
              <div className="flex flex-col gap-2">
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
                        dot={markedLine === "ctl" ? EstimatedDot : false}
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
                        dot={markedLine === "atl" ? EstimatedDot : false}
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
                        dot={markedLine === "tsb" ? EstimatedDot : false}
                        isAnimationActive={false}
                      />
                    ) : null}
                  </ComposedChart>
                </ChartContainer>
                {markedLine && hasEstimatedDays ? (
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: ESTIMATED_DOT_COLOR }}
                    />
                    Days with estimated load
                  </p>
                ) : null}
              </div>
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
