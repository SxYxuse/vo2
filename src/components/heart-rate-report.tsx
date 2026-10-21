"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { useDesktopMedia } from "@/hooks/use-desktop-media.ts";
import {
  HR_ZONES,
  formatHmm,
  type HeartRateSport,
  type HeartRateZoneId,
} from "@/services/heart-rate.ts";
import {
  buildHeartRateReport,
  reportBucketSize,
  type HeartRateReportBucket,
  type ReportBucketSize,
} from "@/services/heart-rate-report.ts";
import { periodStartMs, type FitnessPeriod } from "@/services/training-load.ts";
import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const CHART_CONFIG = Object.fromEntries(
  HR_ZONES.map((zone) => [zone.id, { label: `${zone.label} · ${zone.name}`, color: zone.color }]),
) satisfies ChartConfig;

const DAY_TICK = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const WEEK_TICK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH_TICK = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });

const SIZE_LABEL: Record<ReportBucketSize, string> = { day: "day", week: "week", month: "month" };

const INTENSITY_INFO =
  "Easy is zones 1–2, moderate is zone 3, hard is zones 4–5, each in that sport's own zones. Endurance plans usually keep about 80% easy and most of the rest hard, with little in between.";

const AVG_INFO =
  "Time-weighted average heart rate across every heart-rate sample in the period. It rises with harder training, and with heat, fatigue, or illness at the same effort.";

function bucketLabel(key: string, size: ReportBucketSize) {
  const [year, month, day = 1] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (size === "day") return DAY_TICK.format(date);
  if (size === "week") return WEEK_TICK.format(date);
  return MONTH_TICK.format(date);
}

function pct(share: number) {
  return `${Math.round(share * 100)}%`;
}

type ChartRow = HeartRateReportBucket & Record<HeartRateZoneId, number>;

/** Time in zone per day, week, or month of the selected period, with averages and intensity split. */
export function HeartRateReportCard({
  sport,
  period,
}: {
  sport: HeartRateSport;
  period: FitnessPeriod;
}) {
  const isDesktop = useDesktopMedia();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const size = reportBucketSize(period);
  const report = useMemo(
    () =>
      buildHeartRateReport(sport.sessions, {
        size,
        timeZone,
        startMs: periodStartMs(period, timeZone),
      }),
    [sport.sessions, size, timeZone, period],
  );
  const rows = useMemo<ChartRow[]>(
    () =>
      report.buckets.map((bucket) => ({
        ...bucket,
        ...(Object.fromEntries(
          HR_ZONES.map((zone, index) => [
            zone.id,
            Math.round(((bucket.zoneSeconds[index] ?? 0) / 3600) * 100) / 100,
          ]),
        ) as Record<HeartRateZoneId, number>),
      })),
    [report.buckets],
  );

  if (report.seconds <= 0) return null;
  const intensity = report.intensity;

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>Report</CardTitle>
        <CardDescription>
          Time in zone per {SIZE_LABEL[size]}, from heart-rate streams.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Per week</dt>
            <dd className="font-mono font-medium tabular-nums">
              {formatHmm(report.weeklySeconds)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Sessions</dt>
            <dd className="font-mono font-medium tabular-nums">{report.sessions}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="flex items-center gap-1 text-muted-foreground">
              Avg HR
              <InfoTooltip label="About average heart rate">{AVG_INFO}</InfoTooltip>
            </dt>
            <dd className="font-mono font-medium tabular-nums">
              {report.avgBpm != null ? `${Math.round(report.avgBpm)} bpm` : "—"}
            </dd>
          </div>
        </dl>

        {intensity ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1 text-sm">
              <span className="font-medium">Intensity split</span>
              <InfoTooltip label="About the intensity split">{INTENSITY_INFO}</InfoTooltip>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-md bg-muted">
              <div
                className="h-full"
                style={{ width: pct(intensity.low), backgroundColor: HR_ZONES[1].color }}
              />
              <div
                className="h-full"
                style={{ width: pct(intensity.moderate), backgroundColor: HR_ZONES[2].color }}
              />
              <div
                className="h-full"
                style={{ width: pct(intensity.high), backgroundColor: HR_ZONES[4].color }}
              />
            </div>
            <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
              <span>Easy {pct(intensity.low)}</span>
              <span>Moderate {pct(intensity.moderate)}</span>
              <span>Hard {pct(intensity.high)}</span>
            </div>
          </div>
        ) : null}

        <ChartContainer config={CHART_CONFIG} className="aspect-auto h-48 w-full sm:h-60">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              minTickGap={16}
              tickFormatter={(value) => bucketLabel(String(value), size)}
            />
            <YAxis
              hide={isDesktop !== true}
              tickLine={false}
              axisLine={false}
              width={isDesktop === true ? 32 : 0}
              tickFormatter={(value) => `${Number(value)}h`}
            />
            <ChartTooltip
              cursor={{ fill: "var(--color-muted)" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_value, payload) => {
                    const row = payload?.[0]?.payload as ChartRow | undefined;
                    if (!row) return "";
                    const avg = row.avgBpm != null ? ` · avg ${Math.round(row.avgBpm)} bpm` : "";
                    const prefix = size === "week" ? "Week of " : "";
                    return `${prefix}${bucketLabel(row.key, size)} · ${formatHmm(row.seconds)}${avg}`;
                  }}
                  formatter={(value, name, item) => {
                    const key = String(item.dataKey ?? name) as keyof typeof CHART_CONFIG;
                    const meta = CHART_CONFIG[key];
                    if (!meta || typeof value !== "number" || value <= 0) return null;
                    return (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{meta.label}</span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatHmm(value * 3600)}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            {HR_ZONES.map((zone) => (
              <Bar
                key={zone.id}
                dataKey={zone.id}
                stackId="zones"
                fill={`var(--color-${zone.id})`}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
