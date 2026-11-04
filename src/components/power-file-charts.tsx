"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { SERIES_META } from "@/components/activity-detail-series.ts";
import { formatElapsedTick } from "@/services/activity-detail.ts";
import type { PowerFileView, Quadrants } from "@/services/power-file.ts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Left and right pedal, everywhere a side is drawn. */
export const SIDE_COLOR = {
  left: "var(--color-ds-teal-700)",
  right: "var(--color-ds-pink-700)",
} as const;

const AXIS = { tickLine: false, axisLine: false } as const;

function TipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="bg-background grid min-w-32 gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

type Series = PowerFileView["series"];
type TimeView = "watts" | "heartrate" | "cadence" | "balance" | "pco" | "speed";

const TIME_VIEWS: {
  id: TimeView;
  label: string;
  lines: { key: string; label: string; color: string; unit: string }[];
}[] = [
  {
    id: "watts",
    label: "Power",
    lines: [{ key: "watts", label: "Power", color: SERIES_META.watts.color, unit: "W" }],
  },
  {
    id: "heartrate",
    label: "HR",
    lines: [
      { key: "heartrate", label: "Heart rate", color: SERIES_META.heartrate.color, unit: "bpm" },
    ],
  },
  {
    id: "cadence",
    label: "Cadence",
    lines: [{ key: "cadence", label: "Cadence", color: SERIES_META.cadence.color, unit: "rpm" }],
  },
  {
    id: "balance",
    label: "Balance",
    lines: [{ key: "rightPct", label: "Right pedal", color: SIDE_COLOR.right, unit: "%" }],
  },
  {
    id: "pco",
    label: "PCO",
    lines: [
      { key: "pcoLeft", label: "Left PCO", color: SIDE_COLOR.left, unit: "mm" },
      { key: "pcoRight", label: "Right PCO", color: SIDE_COLOR.right, unit: "mm" },
    ],
  },
  {
    id: "speed",
    label: "Speed",
    lines: [{ key: "speedKmh", label: "Speed", color: SERIES_META.speed.color, unit: "km/h" }],
  },
];

/** One measure against moving time, over the elevation profile. */
export function RideOverTimeChart({ series }: { series: Series }) {
  const views = TIME_VIEWS.filter((view) =>
    view.lines.some((line) =>
      (series[line.key as keyof Series] as (number | null)[]).some((value) => value != null),
    ),
  );
  const [selected, setSelected] = useState<TimeView>("watts");
  const view = views.find((item) => item.id === selected) ?? views[0];
  const rows = useMemo(
    () =>
      series.t.map((t, index) => ({
        t,
        altitude: series.altitude[index],
        watts: series.watts[index],
        heartrate: series.heartrate[index],
        cadence: series.cadence[index],
        rightPct: series.rightPct[index],
        pcoLeft: series.pcoLeft[index],
        pcoRight: series.pcoRight[index],
        speedKmh: series.speedKmh[index],
      })),
    [series],
  );
  if (!view) return null;
  const config = Object.fromEntries(
    view.lines.map((line) => [line.key, { label: line.label, color: line.color }]),
  ) satisfies ChartConfig;

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        size="sm"
        variant="outline"
        spacing={0}
        value={[view.id]}
        onValueChange={(next) => {
          if (next[0]) setSelected(next[0] as TimeView);
        }}
        className="flex-wrap"
      >
        {views.map((item) => (
          <ToggleGroupItem key={item.id} value={item.id}>
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ChartContainer config={config} className="aspect-auto h-48 w-full sm:h-64">
        <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            {...AXIS}
            minTickGap={48}
            tickFormatter={(value) => formatElapsedTick(Number(value))}
          />
          <YAxis yAxisId="alt" hide domain={["dataMin", "dataMax"]} />
          <YAxis
            yAxisId="value"
            {...AXIS}
            width={36}
            domain={view.id === "balance" ? [35, 65] : ["auto", "auto"]}
            allowDataOverflow={view.id === "balance"}
            tickFormatter={(value) => String(Math.round(Number(value)))}
          />
          {view.id === "balance" ? (
            <ReferenceLine
              yAxisId="value"
              y={50}
              stroke="var(--color-border)"
              strokeDasharray="4 3"
            />
          ) : null}
          {view.id === "pco" ? (
            <ReferenceLine
              yAxisId="value"
              y={0}
              stroke="var(--color-border)"
              strokeDasharray="4 3"
            />
          ) : null}
          <Area
            yAxisId="alt"
            dataKey="altitude"
            type="monotone"
            fill={SERIES_META.altitude.color}
            fillOpacity={0.1}
            stroke="none"
            isAnimationActive={false}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
            content={tipFor<(typeof rows)[number]>((row) => (
              <TipBox
                title={formatElapsedTick(row.t)}
                rows={view.lines.map((line) => {
                  const value = row[line.key as keyof typeof row];
                  return [line.label, value == null ? "—" : `${value} ${line.unit}`];
                })}
              />
            ))}
          />
          {view.lines.map((line) => (
            <Line
              key={line.key}
              yAxisId="value"
              dataKey={line.key}
              type="monotone"
              stroke={line.color}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ChartContainer>
      <p className="text-muted-foreground text-xs">
        Averaged over {series.bucketSec} s of moving time, on the elevation profile.
        {view.id === "balance" ? " Above the dashed line, the right pedal does more." : ""}
        {view.id === "pco" ? " Above zero, force is toward the outside of the pedal." : ""}
      </p>
    </div>
  );
}

function shortDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round((seconds / 3600) * 10) / 10}h`;
}

const CURVE_CONFIG = {
  watts: { label: "Power", color: SERIES_META.watts.color },
} satisfies ChartConfig;

export function PowerCurveChart({
  curve,
  weightKg,
}: {
  curve: PowerFileView["power"]["curve"];
  weightKg: number | null;
}) {
  const ticks = [1, 5, 30, 60, 300, 1200, 3600, 10800].filter(
    (tick) => tick >= (curve[0]?.seconds ?? 0) && tick <= (curve.at(-1)?.seconds ?? 0),
  );
  return (
    <ChartContainer config={CURVE_CONFIG} className="aspect-auto h-48 w-full sm:h-60">
      <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="seconds"
          type="number"
          scale="log"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          {...AXIS}
          tickFormatter={(value) => shortDuration(Number(value))}
        />
        <YAxis {...AXIS} width={36} tickFormatter={(value) => String(Math.round(Number(value)))} />
        <ChartTooltip
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
          content={tipFor<(typeof curve)[number]>((point) => {
            const rows: [string, string][] = [["Best average", `${point.watts} W`]];
            if (weightKg) rows.push(["Per kg", `${(point.watts / weightKg).toFixed(2)} W/kg`]);
            return <TipBox title={shortDuration(point.seconds)} rows={rows} />;
          })}
        />
        <Line
          dataKey="watts"
          type="monotone"
          stroke="var(--color-watts)"
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

/** A chart tooltip that renders the hovered row, or nothing. */
function tipFor<T>(render: (row: T) => ReactNode) {
  return function Tip({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: readonly { payload?: unknown }[];
  }) {
    const row = payload?.[0]?.payload as T | undefined;
    return active && row ? render(row) : null;
  };
}

type HistogramRow = { x: number } & Record<string, number>;

/** Time spent in each bin, one bar per series in `config`. */
function TimeHistogram({
  rows: given,
  step,
  config,
  title,
  className,
  zeroLine = false,
}: {
  rows: HistogramRow[];
  /** Bin width: empty bins between the first and last are drawn as zero, so the axis is even. */
  step: number;
  config: Record<string, { label: string; color: string }>;
  title: (x: number) => string;
  className: string;
  zeroLine?: boolean;
}) {
  const keys = useMemo(() => Object.keys(config), [config]);
  const rows = useMemo(() => {
    if (!given.length) return given;
    const byX = new Map(given.map((row) => [row.x, row]));
    const filled: HistogramRow[] = [];
    for (let x = given[0].x; x <= given.at(-1)!.x; x += step) {
      filled.push(
        byX.get(x) ?? ({ x, ...Object.fromEntries(keys.map((key) => [key, 0])) } as HistogramRow),
      );
    }
    return filled;
  }, [given, step, keys]);
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={0}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="x" {...AXIS} minTickGap={14} />
        <YAxis hide />
        {zeroLine ? <ReferenceLine x={0} stroke="var(--color-border)" /> : null}
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)" }}
          content={tipFor<HistogramRow>((row) => (
            <TipBox
              title={title(row.x)}
              rows={keys.map((key) => [config[key].label, formatElapsedTick(row[key] ?? 0)])}
            />
          ))}
        />
        {keys.map((key) => (
          <Bar key={key} dataKey={key} fill={`var(--color-${key})`} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

const PCO_CONFIG = {
  left: { label: "Left", color: SIDE_COLOR.left },
  right: { label: "Right", color: SIDE_COLOR.right },
} satisfies ChartConfig;

/** Pedaling time at each platform center offset, left and right side by side. */
export function PcoHistogram({ histogram }: { histogram: PowerFileView["pcoHistogram"] }) {
  return (
    <TimeHistogram
      rows={histogram.map(([x, left, right]) => ({ x, left, right }))}
      step={1}
      config={PCO_CONFIG}
      title={(mm) => `${mm > 0 ? "+" : ""}${mm} mm`}
      className="aspect-auto h-40 w-full sm:h-52"
      zeroLine
    />
  );
}

const CADENCE_CONFIG = {
  sec: { label: "Time", color: SERIES_META.cadence.color },
} satisfies ChartConfig;

export function CadenceHistogram({ histogram }: { histogram: [number, number][] }) {
  return (
    <TimeHistogram
      rows={histogram.map(([x, sec]) => ({ x, sec }))}
      step={5}
      config={CADENCE_CONFIG}
      title={(rpm) => `${rpm}–${rpm + 5} rpm`}
      className="aspect-auto h-36 w-full sm:h-48"
    />
  );
}

const QUADRANT_CONFIG = {
  sec: { label: "Time", color: SERIES_META.watts.color },
} satisfies ChartConfig;

/**
 * Quadrant analysis on cadence and torque: the same split as pedal force against pedal speed,
 * without needing the crank length. The curve is every pairing that makes FTP.
 */
export function QuadrantChart({
  cells,
  quadrants,
  ftp,
}: {
  cells: PowerFileView["forceCells"];
  quadrants: Quadrants | null;
  ftp: number | null;
}) {
  const points = useMemo(
    () => cells.map(([rpm, nm, sec]) => ({ rpm: rpm + 1, nm: nm + 1, sec })),
    [cells],
  );
  const maxRpm = Math.max(130, ...points.map((point) => point.rpm));
  const maxNm = Math.min(120, Math.max(40, ...points.map((point) => point.nm)));
  const ftpCurve = useMemo(() => {
    if (!ftp) return [];
    const curve: { rpm: number; ftpNm: number }[] = [];
    for (let rpm = 30; rpm <= maxRpm; rpm += 2) {
      const nm = ftp / ((rpm * 2 * Math.PI) / 60);
      if (nm <= maxNm) curve.push({ rpm, ftpNm: Math.round(nm * 10) / 10 });
    }
    return curve;
  }, [ftp, maxRpm, maxNm]);

  return (
    <ChartContainer config={QUADRANT_CONFIG} className="aspect-auto h-60 w-full sm:h-72">
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="rpm"
          name="Cadence"
          domain={[20, maxRpm]}
          {...AXIS}
          tickFormatter={(value) => `${value}`}
        />
        <YAxis
          type="number"
          dataKey="nm"
          name="Torque"
          domain={[0, maxNm]}
          allowDataOverflow
          {...AXIS}
          width={32}
        />
        <ZAxis type="number" dataKey="sec" range={[6, 60]} />
        {quadrants ? (
          <>
            <ReferenceLine
              x={quadrants.cadence}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 3"
            />
            <ReferenceLine
              y={quadrants.torque}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 3"
            />
          </>
        ) : null}
        <ChartTooltip
          cursor={false}
          content={tipFor<{ rpm: number; nm: number; sec?: number }>((point) =>
            // The FTP curve's points carry no time and get no tooltip.
            point.sec == null ? null : (
              <TipBox
                title={`${point.rpm} rpm · ${point.nm} Nm`}
                rows={[["Time", formatElapsedTick(point.sec)]]}
              />
            ),
          )}
        />
        <Scatter
          data={points}
          fill="var(--color-sec)"
          fillOpacity={0.35}
          isAnimationActive={false}
        />
        {ftpCurve.length ? (
          <Scatter
            data={ftpCurve.map((point) => ({ rpm: point.rpm, nm: point.ftpNm }))}
            line={{ stroke: "var(--color-foreground)", strokeWidth: 1.5 }}
            shape={() => <g />}
            legendType="none"
            isAnimationActive={false}
          />
        ) : null}
      </ScatterChart>
    </ChartContainer>
  );
}
