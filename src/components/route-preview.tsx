"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";

import { planningProducts } from "@/services/fuel-catalog.ts";
import { formatAroundTime, type FuelRole, type Intake } from "@/services/fuel-plan.ts";
import {
  climbAtKm,
  elevationTicks,
  pointAtKm,
  type ProfilePoint,
  type RoutePlanView,
} from "@/services/route-plan.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const PRODUCTS = planningProducts();
const nameOf = (id: string) => PRODUCTS.find((product) => product.id === id)?.name ?? id;

const CHART_CONFIG = {
  altitudeM: { label: "Elevation", color: "var(--color-ds-gray-700)" },
} satisfies ChartConfig;

const CLIMB_COLOR = "var(--color-ds-amber-700)";
const ROLE_COLOR: Record<Exclude<FuelRole, "drink">, string> = {
  gel: "var(--color-ds-blue-700)",
  jelly: "var(--color-ds-green-700)",
  bar: "var(--color-ds-green-700)",
  caffeine: "var(--color-ds-purple-700)",
};

type Axis = "km" | "time";
type ChartPoint = ProfilePoint & { onClimb: boolean };

const RouteTraceMapView = lazy(() =>
  import("./route-trace-map.tsx").then((mod) => ({ default: mod.RouteTraceMapView })),
);

function ElevationTooltip({
  active,
  payload,
  food,
}: {
  active?: boolean;
  payload?: readonly { payload?: ChartPoint }[];
  food: Intake[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const next = food.find((intake) => intake.atSec >= point.atSec);
  return (
    <div className="grid min-w-36 gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs/relaxed shadow-xl">
      <div className="font-medium tabular-nums">
        ~{formatAroundTime(point.atSec)} · km {point.km.toFixed(1)}
      </div>
      <div className="text-muted-foreground tabular-nums">
        {point.altitudeM} m · {point.gradePct.toFixed(1)} %
      </div>
      {point.onClimb ? <div className="text-ds-amber-700">Climb</div> : null}
      {next ? (
        <div className="text-muted-foreground">
          Next: {nameOf(next.productId)} ~{formatAroundTime(next.atSec)}
        </div>
      ) : null}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="block size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function RoutePreview({ plan }: { plan: RoutePlanView }) {
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [activeClimbStart, setActiveClimbStart] = useState<number | null>(null);
  const [axis, setAxis] = useState<Axis>("km");
  const { climbs } = plan.prediction;
  const food = useMemo(
    () => plan.chosen?.intakes.filter((intake) => intake.role !== "drink") ?? [],
    [plan.chosen],
  );
  const hasMap = plan.profile.some(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  );
  const chartData = useMemo<ChartPoint[]>(
    () =>
      plan.profile.map((point) => ({
        ...point,
        onClimb: climbAtKm(climbs, point.km) != null,
      })),
    [climbs, plan.profile],
  );
  const yTicks = useMemo(() => {
    const altitudes = plan.profile.map((point) => point.altitudeM);
    return elevationTicks(Math.min(...altitudes), Math.max(...altitudes));
  }, [plan.profile]);
  const hoverPoint = hoverKm == null ? null : pointAtKm(plan.profile, hoverKm);
  const xOf = (point: { km: number; atSec: number }) => (axis === "km" ? point.km : point.atSec);

  if (!plan.prediction.hasElevation && !hasMap) return null;

  return (
    <div className="flex flex-col gap-3">
      {hasMap ? (
        <div className="h-56 overflow-hidden rounded-xl border sm:h-72">
          <Suspense fallback={<Skeleton className="h-full w-full rounded-xl" />}>
            <RouteTraceMapView
              points={plan.profile}
              climbs={climbs}
              hoverKm={hoverKm}
              activeClimbStart={activeClimbStart}
              onHoverKm={setHoverKm}
              onSelectClimb={setActiveClimbStart}
            />
          </Suspense>
        </div>
      ) : null}

      {plan.prediction.hasElevation ? (
        <section aria-label="Elevation" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Elevation</h2>
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="Chart axis"
              value={[axis]}
              onValueChange={(next) => {
                if (next[0] === "km" || next[0] === "time") setAxis(next[0]);
              }}
            >
              <ToggleGroupItem value="km">km</ToggleGroupItem>
              <ToggleGroupItem value="time">Time</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <ChartContainer config={CHART_CONFIG} className="aspect-auto h-44 w-full sm:h-56">
            <AreaChart
              data={chartData}
              margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              onMouseMove={(state) => {
                setHoverKm(chartData[Number(state.activeTooltipIndex)]?.km ?? null);
              }}
              onMouseLeave={() => setHoverKm(null)}
              onClick={(state) => {
                const km = chartData[Number(state.activeTooltipIndex)]?.km;
                if (km == null) return;
                setActiveClimbStart(climbAtKm(climbs, km)?.startSec ?? null);
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={axis === "km" ? "km" : "atSec"}
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
                tickFormatter={(value) =>
                  axis === "km"
                    ? `${Math.round(Number(value))} km`
                    : formatAroundTime(Number(value))
                }
              />
              <YAxis
                dataKey="altitudeM"
                width={56}
                tickLine={false}
                axisLine={false}
                domain={[yTicks[0] ?? 0, yTicks.at(-1) ?? 0]}
                ticks={yTicks}
                // A no-break space keeps "1000 m" on one line.
                tickFormatter={(value) => `${Number(value)}\u00a0m`}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
                content={<ElevationTooltip food={food} />}
              />
              {climbs.map((climb) => (
                <ReferenceArea
                  key={climb.startSec}
                  x1={axis === "km" ? climb.startKm : climb.startSec}
                  x2={axis === "km" ? climb.endKm : climb.endSec}
                  fill={CLIMB_COLOR}
                  fillOpacity={activeClimbStart === climb.startSec ? 0.28 : 0.12}
                />
              ))}
              <Area
                dataKey="altitudeM"
                type="monotone"
                stroke="var(--color-altitudeM)"
                fill="var(--color-altitudeM)"
                fillOpacity={0.15}
                strokeWidth={1.5}
                isAnimationActive={false}
                activeDot={{ r: 3 }}
              />
              {food.map((intake) => {
                const at = pointAtKm(plan.profile, intake.km);
                if (!at || intake.role === "drink") return null;
                return (
                  <ReferenceDot
                    key={`${intake.atSec}-${intake.productId}`}
                    x={xOf(intake)}
                    y={at.altitudeM}
                    r={4}
                    fill={ROLE_COLOR[intake.role]}
                    stroke="var(--color-background)"
                    strokeWidth={1.5}
                  />
                );
              })}
              {hoverPoint ? (
                <ReferenceDot
                  x={xOf(hoverPoint)}
                  y={hoverPoint.altitudeM}
                  r={4}
                  fill="var(--color-foreground)"
                  stroke="var(--color-background)"
                  strokeWidth={2}
                />
              ) : null}
            </AreaChart>
          </ChartContainer>
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <LegendDot color={CLIMB_COLOR} label="Climb" />
            {food.length > 0 ? (
              <>
                <LegendDot color={ROLE_COLOR.gel} label="Gel" />
                <LegendDot color={ROLE_COLOR.jelly} label="Jelly or bar" />
                {food.some((intake) => intake.role === "caffeine") ? (
                  <LegendDot color={ROLE_COLOR.caffeine} label="Caffeine" />
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {climbs.length > 0 ? (
        // Collapsed by default: the chart already shows where the climbs are.
        <Collapsible
          render={<section aria-label="Climbs" />}
          className="flex flex-col overflow-hidden rounded-xl border"
        >
          <CollapsibleTrigger className="group/climbs hover:bg-muted/50 flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
            <span className="font-medium">
              {climbs.length} climb{climbs.length > 1 ? "s" : ""}
              <span className="text-muted-foreground font-normal tabular-nums">
                {" "}
                · {climbs.reduce((sum, climb) => sum + climb.gainM, 0)} m up
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden
              className="text-muted-foreground size-4 transition-transform group-data-panel-open/climbs:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col divide-y border-t text-sm">
              {climbs.map((climb) => {
                const selected = activeClimbStart === climb.startSec;
                return (
                  <li key={climb.startSec}>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full flex-wrap justify-between gap-x-3 px-3 py-2 text-start tabular-nums ${
                        selected ? "bg-ds-amber-700/10" : "hover:bg-muted/50"
                      }`}
                      onClick={() => setActiveClimbStart(selected ? null : climb.startSec)}
                    >
                      <span>
                        around {formatAroundTime(climb.startSec)} · km {climb.startKm}–{climb.endKm}
                      </span>
                      <span className="text-muted-foreground">
                        {climb.gainM} m at {climb.avgGradePct ?? "—"} %, ~
                        {Math.round(climb.durationSec / 60)} min
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
