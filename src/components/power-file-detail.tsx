"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ActivityIcon, ChevronLeftIcon, SparklesIcon, Trash2Icon, ZapIcon } from "lucide-react";

import { ActivityDetailSection } from "@/components/activity-detail-section.tsx";
import { ActivityRideAnalysis } from "@/components/activity-ride-analysis.tsx";
import { PedalStroke } from "@/components/pedal-stroke.tsx";
import {
  CadenceHistogram,
  PcoHistogram,
  PowerCurveChart,
  QuadrantChart,
  RideOverTimeChart,
  SIDE_COLOR,
} from "@/components/power-file-charts.tsx";
import { formatBalance } from "@/components/power-files.tsx";
import { StatGridSkeleton } from "@/components/route-states.tsx";
import { StatCard, StatGrid } from "@/components/stat-card.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import {
  formatActivitySchedule,
  formatBpm,
  formatDistanceKm,
  formatDuration,
  formatWatts,
} from "@/services/activity-detail.ts";
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { decouplingInfo, decouplingLabel } from "@/services/heart-insights.ts";
import {
  deletePowerFile,
  powerFileTitle,
  type Pedaling,
  type PowerFileDetail,
  type PowerFileView,
} from "@/services/power-file.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const INFO = {
  balance:
    "Each pedal's share of your power, weighed by power so soft strokes count less. A few percent either way is normal; watch for a side that drifts as you tire or after an injury.",
  pco: "Platform center offset: where on the pedal you push, in mm from its center. Positive is toward the outside of the pedal, negative toward the crank. Look at the trend and the difference between sides, not the number alone; cleat position and stance width move it.",
  phase:
    "Power phase: the arc of the crank where the pedal makes positive power, from top dead center (0°). The heavy part is the peak power phase, where most of the force goes in. Standing usually starts it earlier and widens it.",
  quadrants:
    "Each dot is time spent at a cadence and torque. The curve is every pairing that makes your FTP; the dashed lines cross at your average cadence on it. I: high force, fast pedaling (sprints, hard surges). II: high force, slow (climbing, big gears). III: low force, slow (easy riding). IV: low force, fast (spinning, descending).",
  torque:
    "Torque at the crank: power divided by how fast the crank turns. High torque at low cadence loads muscles; the same power at higher cadence loads the heart and lungs more.",
  efficiency:
    "Normalized power per heartbeat. Compare it across similar rides: rising means more work for the same heart rate.",
  crossChain:
    "Time on the big ring with the two biggest cogs, or the small ring with the two smallest: the chain runs at an angle and wears faster.",
  ftp: "The FTP behind zones, intensity, and the quadrants. VO2's own FTP when it has one, else the one set on your head unit.",
} as const;

/** The power file on the page, for the coach links at the end of each section. */
const PowerFileIdContext = createContext("");

/** Opens the coach chat with this power file brought in and the question ready to send. */
function AskCoach({ question }: { question: string }) {
  const fileId = use(PowerFileIdContext);
  return (
    <Link
      to="/coach"
      search={{ power: fileId, ask: question }}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "h-auto min-h-11 max-w-full justify-start self-start py-1.5 text-left whitespace-normal sm:min-h-8",
      )}
    >
      <SparklesIcon />
      {question}
    </Link>
  );
}

function fixed(value: number | null | undefined, digits = 0, unit = "") {
  if (value == null) return "—";
  const gap = unit && unit !== "°" ? " " : "";
  return `${value.toFixed(digits)}${gap}${unit}`;
}

/** "sweet spot" → "Sweet spot": zone labels are lower case for use mid-sentence. */
function sentence(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function signedMm(value: number | null) {
  if (value == null) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} mm`;
}

function share(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)} %` : "—";
}

function sourceLabel(source: "vo2" | "file") {
  return source === "vo2" ? "VO2" : "head unit";
}

function BalanceBar({ rightPct }: { rightPct: number }) {
  const left = 100 - rightPct;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm font-semibold tabular-nums">
        <span style={{ color: SIDE_COLOR.left }}>Left {left.toFixed(1)} %</span>
        <span style={{ color: SIDE_COLOR.right }}>Right {rightPct.toFixed(1)} %</span>
      </div>
      <div className="bg-muted relative flex h-3 overflow-hidden rounded-full" aria-hidden>
        <div style={{ width: `${left}%`, backgroundColor: SIDE_COLOR.left }} />
        <div style={{ width: `${rightPct}%`, backgroundColor: SIDE_COLOR.right }} />
        <div className="bg-background absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2" />
      </div>
    </div>
  );
}

function NumberTable({
  head,
  rows,
}: {
  head: ReactNode[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <Table className="tabular-nums">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {head.map((cell, index) => (
            <TableHead key={index} className={cn("font-sans", index > 0 && "text-right")}>
              {cell}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            {row.cells.map((cell, index) => (
              <TableCell
                key={index}
                className={cn(index === 0 ? "font-sans font-medium" : "text-right")}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function pairOf(left: string, right: string) {
  return (
    <>
      <span style={{ color: SIDE_COLOR.left }}>{left}</span>
      {" · "}
      <span style={{ color: SIDE_COLOR.right }}>{right}</span>
    </>
  );
}

function PowerSummary({ view }: { view: PowerFileView }) {
  const twenty = view.power.curve.find((point) => point.seconds === 1200);
  const weight = view.weightKg?.value ?? null;
  return (
    <StatGrid className="sm:grid-cols-4">
      <StatCard
        label="Avg / NP"
        value={`${view.power.avg} / ${fixed(view.power.normalized)} W`}
        hint={
          view.power.variabilityIndex ? `VI ${view.power.variabilityIndex.toFixed(2)}` : undefined
        }
      />
      <StatCard label="Max power" value={formatWatts(view.power.max)} />
      <StatCard
        label="IF · TSS"
        value={
          view.power.intensityFactor != null && view.power.tss != null
            ? `${view.power.intensityFactor.toFixed(2)} · ${Math.round(view.power.tss)}`
            : "—"
        }
        hint={view.ftp ? `FTP ${view.ftp.value} W (${sourceLabel(view.ftp.source)})` : "No FTP"}
        info={INFO.ftp}
      />
      <StatCard label="Work" value={`${view.power.workKj.toLocaleString("en-US")} kJ`} />
      <StatCard
        label="Balance"
        value={formatBalance(view.pedaling.overall.rightPct)}
        info={INFO.balance}
      />
      <StatCard
        label="Best 20 min"
        value={twenty ? formatWatts(twenty.watts) : "—"}
        hint={twenty && weight ? `${(twenty.watts / weight).toFixed(2)} W/kg` : undefined}
      />
      <StatCard label="Moving time" value={formatDuration(view.movingSec)} />
      <StatCard label="Distance" value={formatDistanceKm(view.distanceM)} />
    </StatGrid>
  );
}

const KEY_DURATIONS = [
  [5, "5 s"],
  [60, "1 min"],
  [300, "5 min"],
  [1200, "20 min"],
  [3600, "60 min"],
] as const;

function PowerCurveSection({ view }: { view: PowerFileView }) {
  const weight = view.weightKg?.value ?? null;
  const keys = KEY_DURATIONS.flatMap(([seconds, label]) => {
    const point = view.power.curve.find((item) => item.seconds === seconds);
    return point ? [{ label, watts: point.watts }] : [];
  });
  return (
    <ActivityDetailSection
      title="Power curve"
      description="The best average power you held for each duration on this ride."
    >
      <StatGrid className="grid-cols-3 sm:grid-cols-5">
        {keys.map((key) => (
          <StatCard
            key={key.label}
            label={key.label}
            value={formatWatts(key.watts)}
            hint={weight ? `${(key.watts / weight).toFixed(2)} W/kg` : undefined}
          />
        ))}
      </StatGrid>
      <PowerCurveChart curve={view.power.curve} weightKg={weight} />
      {weight ? (
        <p className="text-muted-foreground text-xs">
          W/kg at {weight} kg ({sourceLabel(view.weightKg!.source)}).
        </p>
      ) : null}
      <AskCoach question="What does this power curve say about my strengths?" />
    </ActivityDetailSection>
  );
}

function ZonesSection({ view }: { view: PowerFileView }) {
  if (!view.ftp) {
    return (
      <ActivityDetailSection title="Power zones">
        <p className="text-muted-foreground text-sm">
          Zones need an FTP. VO2 estimates one once it has rides with power, and your head unit can
          store one in the file.
        </p>
      </ActivityDetailSection>
    );
  }
  const widest = Math.max(...view.zones.map((zone) => zone.pct), 1);
  return (
    <ActivityDetailSection
      title="Power zones"
      description={`Time in each zone at FTP ${view.ftp.value} W, coasting included.`}
    >
      <ul className="flex flex-col gap-2">
        {view.zones.map((zone) => (
          <li key={zone.id} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-xs">
            <span className="min-w-0">
              <span className="block truncate font-medium">{sentence(zone.label)}</span>
              <span className="text-muted-foreground tabular-nums">
                {zone.maxWatts == null ? `> ${zone.minWatts}` : `${zone.minWatts}–${zone.maxWatts}`}{" "}
                W
              </span>
            </span>
            <span className="bg-muted h-3 overflow-hidden rounded-full">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(zone.pct / widest) * 100}%`,
                  backgroundColor: "var(--color-ds-amber-700)",
                }}
              />
            </span>
            <span className="text-right tabular-nums">
              {zone.pct.toFixed(0)} %
              <span className="text-muted-foreground block">{formatDuration(zone.sec)}</span>
            </span>
          </li>
        ))}
      </ul>
      <AskCoach question="Was my time in each zone right for this kind of ride?" />
    </ActivityDetailSection>
  );
}

function hasDynamics(pedaling: Pedaling) {
  return Boolean(
    pedaling.left.phase ||
    pedaling.right.phase ||
    pedaling.left.pco != null ||
    pedaling.right.pco != null,
  );
}

function PedalingSection({ view }: { view: PowerFileView }) {
  const overall = view.pedaling.overall;
  const dynamics = hasDynamics(overall);
  const te = overall.left.torqueEffectiveness ?? overall.right.torqueEffectiveness;
  const ps = overall.left.pedalSmoothness ?? overall.right.pedalSmoothness;
  const zones = view.zones.filter((zone) => zone.sec >= 30 && zone.avgCadence != null);
  return (
    <ActivityDetailSection
      title="Pedaling dynamics"
      description="How each leg shares the work, where on the pedal you push, and the arc of each stroke."
    >
      {overall.rightPct != null ? <BalanceBar rightPct={overall.rightPct} /> : null}
      {dynamics ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <PedalStroke label="Left" side={overall.left} color={SIDE_COLOR.left} />
            <PedalStroke label="Right" side={overall.right} color={SIDE_COLOR.right} />
          </div>
          <p className="text-muted-foreground text-xs">{INFO.phase}</p>
          <StatGrid className={te != null || ps != null ? "sm:grid-cols-4" : undefined}>
            <StatCard
              label="Left PCO"
              value={signedMm(overall.left.pco)}
              color={SIDE_COLOR.left}
              info={INFO.pco}
            />
            <StatCard
              label="Right PCO"
              value={signedMm(overall.right.pco)}
              color={SIDE_COLOR.right}
            />
            {te != null ? (
              <StatCard
                label="Torque effectiveness"
                value={pairOf(
                  fixed(overall.left.torqueEffectiveness, 0, "%"),
                  fixed(overall.right.torqueEffectiveness, 0, "%"),
                )}
                hint="Left · right"
              />
            ) : null}
            {ps != null ? (
              <StatCard
                label="Pedal smoothness"
                value={pairOf(
                  fixed(overall.left.pedalSmoothness, 0, "%"),
                  fixed(overall.right.pedalSmoothness, 0, "%"),
                )}
                hint="Left · right"
              />
            ) : null}
          </StatGrid>
          {view.pcoHistogram.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium">Pedaling time by platform center offset (mm)</p>
              <PcoHistogram histogram={view.pcoHistogram} />
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          This file has no pedal stroke data. Dual-sided pedals such as the Favero Assioma record it
          when the head unit has Cycling Dynamics on.
        </p>
      )}
      {zones.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">By power zone</p>
          <NumberTable
            head={["Zone", "Cadence", "L / R", "PCO L · R", "Phase L · R"]}
            rows={zones.map((zone) => ({
              key: zone.id,
              cells: [
                sentence(zone.label),
                fixed(zone.avgCadence),
                formatBalance(zone.rightPct),
                pairOf(signedMm(zone.left.pco), signedMm(zone.right.pco)),
                pairOf(fixed(zone.left.phase?.arc, 0, "°"), fixed(zone.right.phase?.arc, 0, "°")),
              ],
            }))}
          />
        </div>
      ) : null}
      <AskCoach question="What do my pedaling dynamics say, and what should I change?" />
    </ActivityDetailSection>
  );
}

function PositionsSection({ view }: { view: PowerFileView }) {
  const { seated, standing } = view.pedaling;
  if (!seated && !standing) return null;
  const total = (seated?.sec ?? 0) + (standing?.sec ?? 0);
  const columns = [
    ["Seated", seated],
    ["Standing", standing],
  ] as const;
  const row = (label: string, value: (pedaling: Pedaling) => ReactNode) => ({
    key: label,
    cells: [label, ...columns.map(([, pedaling]) => (pedaling ? value(pedaling) : "—"))],
  });
  return (
    <ActivityDetailSection
      title="Seated and standing"
      description={
        view.standCount != null
          ? `${view.standCount} times out of the saddle, ${formatDuration(standing?.sec ?? 0)} in all.`
          : undefined
      }
    >
      <NumberTable
        head={["", ...columns.map(([label]) => label)]}
        rows={[
          row(
            "Time",
            (pedaling) => `${formatDuration(pedaling.sec)} · ${share(pedaling.sec, total)}`,
          ),
          row("Power", (pedaling) => formatWatts(pedaling.avgWatts)),
          row("Cadence", (pedaling) => fixed(pedaling.avgCadence, 0, "rpm")),
          row("Balance", (pedaling) => formatBalance(pedaling.rightPct)),
          row("PCO L · R", (pedaling) =>
            pairOf(signedMm(pedaling.left.pco), signedMm(pedaling.right.pco)),
          ),
          row("Phase L · R", (pedaling) =>
            pairOf(
              fixed(pedaling.left.phase?.arc, 0, "°"),
              fixed(pedaling.right.phase?.arc, 0, "°"),
            ),
          ),
          row("Phase start", (pedaling) =>
            pairOf(
              fixed(pedaling.left.phase?.start, 0, "°"),
              fixed(pedaling.right.phase?.start, 0, "°"),
            ),
          ),
        ]}
      />
      <AskCoach question="How does my pedaling change out of the saddle, and is that normal?" />
    </ActivityDetailSection>
  );
}

const QUADRANT_NAMES = [
  "I · high force, fast",
  "II · high force, slow",
  "III · low force, slow",
  "IV · low force, fast",
] as const;

function CadenceSection({ view }: { view: PowerFileView }) {
  if (!view.cadence) return null;
  return (
    <ActivityDetailSection
      title="Cadence and torque"
      description="How fast you turned the cranks, how hard you pushed them, and where your power came from."
    >
      <StatGrid className="grid-cols-2 sm:grid-cols-3">
        <StatCard
          label="Cadence"
          value={fixed(view.cadence.avg, 0, "rpm")}
          hint={`Max ${view.cadence.max} rpm`}
        />
        <StatCard
          label="Coasting"
          value={share(view.cadence.coastingSec, view.movingSec)}
          hint={formatDuration(view.cadence.coastingSec)}
        />
        <StatCard
          label="Torque"
          value={fixed(view.torque?.avg, 1, "Nm")}
          hint={view.torque ? `Max ${view.torque.max} Nm` : undefined}
          info={INFO.torque}
        />
      </StatGrid>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">Pedaling time by cadence (rpm)</p>
        <CadenceHistogram histogram={view.cadence.histogram} />
      </div>
      {view.forceCells.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">
            Quadrant analysis: torque (Nm) against cadence (rpm)
          </p>
          <QuadrantChart
            cells={view.forceCells}
            quadrants={view.quadrants}
            ftp={view.ftp?.value ?? null}
          />
          {view.quadrants ? (
            <StatGrid className="grid-cols-2 sm:grid-cols-4">
              {view.quadrants.pct.map((pct, index) => (
                <StatCard
                  key={QUADRANT_NAMES[index]}
                  label={QUADRANT_NAMES[index]}
                  value={`${pct.toFixed(0)} %`}
                />
              ))}
            </StatGrid>
          ) : null}
          <p className="text-muted-foreground text-xs">{INFO.quadrants}</p>
        </div>
      ) : null}
      <AskCoach question="Is my cadence right, and what do my quadrants say?" />
    </ActivityDetailSection>
  );
}

function HeartSection({ view }: { view: PowerFileView }) {
  if (!view.heart && !view.respiration && !view.trainingEffect) return null;
  const decoupling = view.heart?.decoupling;
  return (
    <ActivityDetailSection
      title="Heart and effort"
      description="Your heart rate against the power you held, and what the head unit made of it."
    >
      <StatGrid className="grid-cols-2 sm:grid-cols-4">
        {view.heart ? (
          <StatCard
            label="Heart rate"
            value={formatBpm(view.heart.avg)}
            hint={`Max ${view.heart.max} bpm`}
          />
        ) : null}
        {view.power.efficiencyFactor != null ? (
          <StatCard
            label="Efficiency"
            value={view.power.efficiencyFactor.toFixed(2)}
            hint="NP per bpm"
            info={INFO.efficiency}
          />
        ) : null}
        {decoupling ? (
          <StatCard
            label="Decoupling"
            value={decoupling.status === "ok" ? `${decoupling.pct.toFixed(1)} %` : "—"}
            hint={decoupling.status === "ok" ? decouplingLabel(decoupling.pct) : "Not measured"}
            info={decouplingInfo(decoupling)}
          />
        ) : null}
        {view.respiration?.avg != null ? (
          <StatCard
            label="Breathing"
            value={`${Math.round(view.respiration.avg)} brpm`}
            hint={
              view.respiration.max != null ? `Max ${Math.round(view.respiration.max)}` : undefined
            }
          />
        ) : null}
        {view.trainingEffect?.aerobic != null ? (
          <StatCard
            label="Training effect"
            value={`${view.trainingEffect.aerobic.toFixed(1)} · ${fixed(view.trainingEffect.anaerobic, 1)}`}
            hint="Aerobic · anaerobic (Garmin)"
          />
        ) : null}
        {view.temperature?.avg != null ? (
          <StatCard
            label="Temperature"
            value={`${view.temperature.avg} °C`}
            hint={
              view.temperature.min != null && view.temperature.max != null
                ? `${view.temperature.min}–${view.temperature.max} °C`
                : undefined
            }
          />
        ) : null}
        {view.calories != null ? (
          <StatCard label="Calories" value={`${view.calories} kcal`} />
        ) : null}
      </StatGrid>
      <AskCoach question="What do my heart rate drift and efficiency say about my endurance?" />
    </ActivityDetailSection>
  );
}

function LapsSection({ view }: { view: PowerFileView }) {
  if (!view.laps.length) return null;
  return (
    <ActivityDetailSection
      title="Laps"
      description={`${view.laps.length} laps, as recorded by the head unit.`}
    >
      <NumberTable
        head={[
          "Lap",
          "Time",
          "km",
          "Avg W",
          "NP",
          "L / R",
          "PCO L · R",
          "Phase L · R",
          "rpm",
          "bpm",
          "Standing",
        ]}
        rows={view.laps.map((lap, index) => ({
          key: String(index),
          cells: [
            String(index + 1),
            formatDuration(lap.movingSec),
            lap.distanceM == null ? "—" : (lap.distanceM / 1000).toFixed(1),
            fixed(lap.avgWatts),
            fixed(lap.normalizedWatts),
            formatBalance(lap.rightPct),
            pairOf(signedMm(lap.pcoLeft), signedMm(lap.pcoRight)),
            pairOf(fixed(lap.arcLeft, 0, "°"), fixed(lap.arcRight, 0, "°")),
            fixed(lap.avgCadence),
            fixed(lap.avgHeartrate),
            lap.standingSec ? formatDuration(lap.standingSec) : "—",
          ],
        }))}
      />
      <AskCoach question="What stands out between my laps?" />
    </ActivityDetailSection>
  );
}

function GearsSection({ view }: { view: PowerFileView }) {
  const gears = view.gears;
  if (!gears) return null;
  const total = gears.uses.reduce((sum, use) => sum + use.sec, 0);
  const uses = gears.uses.filter((use) => use.sec >= 10);
  return (
    <ActivityDetailSection
      title="Gears"
      description={`From your electronic shifting: ${gears.chainrings.join("/")} chainrings, ${gears.cogs[0]}–${gears.cogs.at(-1)} cassette.`}
    >
      <StatGrid className="grid-cols-2 sm:grid-cols-3">
        <StatCard label="Front shifts" value={fixed(gears.frontShifts)} />
        <StatCard label="Rear shifts" value={fixed(gears.rearShifts)} />
        {gears.crossChainSec != null ? (
          <StatCard
            label="Cross-chained"
            value={share(gears.crossChainSec, total)}
            hint={formatDuration(gears.crossChainSec)}
            info={INFO.crossChain}
          />
        ) : null}
      </StatGrid>
      <NumberTable
        head={["Gear", "Ratio", "Time", "Share", "Avg W", "rpm", "km/h"]}
        rows={uses.map((use) => ({
          key: `${use.front}x${use.rear}`,
          cells: [
            `${use.front || "–"} × ${use.rear}`,
            use.front ? (use.front / use.rear).toFixed(2) : "—",
            formatDuration(use.sec),
            share(use.sec, total),
            fixed(use.avgWatts),
            fixed(use.avgCadence),
            fixed(use.avgSpeedKmh, 1),
          ],
        }))}
      />
      <AskCoach question="Am I using my gears well?" />
    </ActivityDetailSection>
  );
}

function RecordingSection({ view, fileName }: { view: PowerFileView; fileName: string }) {
  const quality = view.quality;
  const meter = view.powerMeter;
  const rows: [string, string][] = [
    ["File", fileName],
    ["Head unit", view.device ?? "—"],
    [
      "Power meter",
      meter
        ? [
            meter.maker,
            meter.firmware ? `firmware ${meter.firmware}` : null,
            meter.battery ? `battery ${meter.battery}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "—",
    ],
    ["FTP", view.ftp ? `${view.ftp.value} W from ${sourceLabel(view.ftp.source)}` : "—"],
    [
      "Weight",
      view.weightKg ? `${view.weightKg.value} kg from ${sourceLabel(view.weightKg.source)}` : "—",
    ],
    ["Samples", quality.samples.toLocaleString("en-US")],
    ["Power missing", quality.missingPowerSec ? formatDuration(quality.missingPowerSec) : "None"],
    [
      "Balance recorded",
      quality.balancePct == null ? "No (one-sided meter)" : `${quality.balancePct} % of pedaling`,
    ],
    [
      "Pedal stroke recorded",
      quality.dynamicsPct == null ? "No" : `${quality.dynamicsPct} % of pedaling`,
    ],
  ];
  return (
    <ActivityDetailSection
      title="Recording"
      description="Where the numbers come from, and how complete they are."
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <AskCoach question="Can I trust this file's numbers?" />
    </ActivityDetailSection>
  );
}

function BackLink() {
  return (
    <Link
      to="/power"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
    >
      <ChevronLeftIcon />
      Power
    </Link>
  );
}

function DeletePowerFile({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deletion = useMutation({
    mutationFn: () => deletePowerFile({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["power-files"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.removeQueries({ queryKey: ["power-file", id] });
      void navigate({ to: "/power", replace: true });
    },
  });
  const pending = deletion.isPending;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={!online}
        onClick={() => setOpen(true)}
        aria-label="Delete power file"
      >
        <Trash2Icon />
        <span className="hidden sm:inline">Delete</span>
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this power file?</AlertDialogTitle>
            <AlertDialogDescription>
              The file and its analysis are removed from VO2. The ride stays on Strava and in your
              calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletion.isError ? (
            <p className="text-destructive text-sm">Nothing was deleted. Try again.</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => deletion.mutate()}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function PowerFileDetailView({ file }: { file: PowerFileDetail }) {
  const view = file.analysis;
  const end = new Date(new Date(view.start).getTime() + view.elapsedSec * 1000).toISOString();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <BackLink />
          <div className="flex items-center gap-1">
            <Link
              to="/coach"
              search={{ power: file.id }}
              aria-label="Ask the coach about this ride"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <SparklesIcon />
              <span className={cn(file.activity && "hidden sm:inline")}>Ask the coach</span>
            </Link>
            {file.activity ? (
              <Link
                to="/activities/$activityId"
                params={{ activityId: file.activity.id }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ActivityIcon />
                Open ride
              </Link>
            ) : null}
            <DeletePowerFile id={file.id} />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl">
            {powerFileTitle({ activity: file.activity, start: view.start })}
          </h1>
          <Badge variant="outline">{formatSportType(view.sportType)}</Badge>
          {view.powerMeter ? (
            <Badge variant="secondary" className="gap-1">
              <ZapIcon />
              {view.powerMeter.maker}
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">{formatActivitySchedule(view.start, end)}</p>
      </div>
      <PowerFileIdContext value={file.id}>
        <div className="flex flex-col gap-4">
          <PowerSummary view={view} />
          <ActivityDetailSection
            title="Ride over time"
            description="Power, heart rate, cadence, balance, and PCO through the ride."
          >
            <RideOverTimeChart series={view.series} />
          </ActivityDetailSection>
          <PedalingSection view={view} />
          <PositionsSection view={view} />
          <PowerCurveSection view={view} />
          <ZonesSection view={view} />
          <CadenceSection view={view} />
          <HeartSection view={view} />
          <LapsSection view={view} />
          <GearsSection view={view} />
          {view.terrain ? <ActivityRideAnalysis ride={view.terrain} /> : null}
          <RecordingSection view={view} fileName={file.fileName} />
        </div>
      </PowerFileIdContext>
    </div>
  );
}

export function PowerFileDetailPending() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <BackLink />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <StatGridSkeleton cells={8} className="sm:grid-cols-4" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function PowerFileDetailMissing() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <BackLink />
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ZapIcon />
          </EmptyMedia>
          <EmptyTitle>Power file not found</EmptyTitle>
          <EmptyDescription>It was deleted, or it belongs to another athlete.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
