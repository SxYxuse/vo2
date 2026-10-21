"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeartPulseIcon } from "lucide-react";

import { fitnessQueryOptions } from "@/lib/queries.ts";
import { formatDuration } from "@/services/activity-detail.ts";
import {
  decouplingInfo,
  decouplingLabel,
  explainHeartGap,
  formatEfficiency,
  type ActivityHeart,
} from "@/services/heart-insights.ts";
import { HR_ZONES, formatZoneBpm } from "@/services/heart-rate.ts";
import { buildPmc } from "@/services/training-load.ts";
import { dayKey } from "@/services/training-plan.types.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ActivityDetailSection } from "@/components/activity-detail-section.tsx";
import { StatCard, type StatCardProps } from "@/components/stat-card.tsx";

const STAT_INFO = {
  efficiency:
    "Output per heartbeat: normalized power ÷ average heart rate on rides with a power meter, speed ÷ average heart rate on flat runs. Compared with the median of your aerobic sessions in the 6 weeks before. Higher means more work for the same heart rate.",
  peaks:
    "Highest average heart rate you held for 1, 5, and 20 minutes in this session. Steadier than the single max, which a sensor spike can set. Compared with the max HR your zones use.",
  usual:
    "The average heart rate your aerobic sessions of the last 90 days needed for this output. A gap of 5 bpm or more is worth a look: fatigue, heat, sleep, and illness all raise it.",
} as const;

const SKIPPED_HINT = {
  "no-output": "Needs power or a flat run",
  short: "Under 45 minutes",
  unsteady: "Not a steady session",
  hilly: "Too hilly for run speed",
} as const;

function formatOutput(value: number, output: "power" | "speed") {
  return output === "power" ? `${Math.round(value)} W` : `${(value * 3.6).toFixed(1)} km/h`;
}

function signed(value: number, digits = 0, unit = "") {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;
}

function decouplingStat(heart: ActivityHeart): StatCardProps | null {
  const result = heart.decoupling;
  if (!result) return null;
  if (result.status === "skipped") {
    if (result.reason === "no-heartrate") return null;
    return {
      label: "Decoupling",
      value: "—",
      hint: SKIPPED_HINT[result.reason],
      info: decouplingInfo(result),
    };
  }
  return {
    label: "Decoupling",
    value: signed(result.pct, 1, " %"),
    hint: `${decouplingLabel(result.pct)} · ${Math.round(result.firstHalf.avgHeartrate)}→${Math.round(result.secondHalf.avgHeartrate)} bpm at ${formatOutput(result.firstHalf.avgOutput, result.output)}→${formatOutput(result.secondHalf.avgOutput, result.output)}`,
    info: decouplingInfo(result),
    valueClassName:
      result.pct > 10
        ? "text-warning"
        : result.pct < 5 && result.pct >= -5
          ? "text-success"
          : undefined,
  };
}

function efficiencyStat(heart: ActivityHeart): StatCardProps | null {
  const ef = heart.efficiency;
  if (!ef) return null;
  const hint =
    ef.deltaPct != null && ef.norm
      ? `${signed(ef.deltaPct, 1, " %")} vs 6-week norm`
      : "Not enough recent sessions to compare";
  return {
    label: "Efficiency",
    value: formatEfficiency(ef.value, ef.kind),
    hint: ef.aerobic ? hint : `${hint} · hard session`,
    info: STAT_INFO.efficiency,
  };
}

function usualStat(heart: ActivityHeart): StatCardProps | null {
  const usual = heart.usual;
  if (!usual) return null;
  return {
    label: "vs usual HR",
    value: `${signed(usual.gapBpm)} bpm`,
    hint: `Usual ${usual.expectedBpm} bpm for this output`,
    info: STAT_INFO.usual,
    valueClassName: Math.abs(usual.gapBpm) >= 5 ? "text-warning" : undefined,
  };
}

const PEAK_LABEL: Record<number, string> = {
  60: "Best 1 min",
  300: "Best 5 min",
  1200: "Best 20 min",
};

function peakStats(heart: ActivityHeart): StatCardProps[] {
  return heart.peaks.map((peak) => ({
    label: PEAK_LABEL[peak.seconds] ?? `Best ${Math.round(peak.seconds / 60)} min`,
    value: `${peak.bpm} bpm`,
    hint: heart.maxHeartrate
      ? `${Math.round((peak.bpm / heart.maxHeartrate) * 100)}% of max`
      : undefined,
    info: STAT_INFO.peaks,
  }));
}

/** Morning form (yesterday's fitness minus fatigue) on the activity's day, from the cached PMC. */
function useFormOnDay(start: string) {
  const { data } = useQuery(fitnessQueryOptions);
  return useMemo(() => {
    if (!data?.fitnessLoads.length) return null;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const key = dayKey(new Date(start), timeZone);
    const point = buildPmc(data.fitnessLoads, timeZone).find((item) => item.date === key);
    return point ? point.tsb : null;
  }, [data, start]);
}

export function ActivityHeartAnalysis({ heart, start }: { heart: ActivityHeart; start: string }) {
  const tsb = useFormOnDay(start);
  const zones = heart.zones;
  const total = heart.zoneSeconds;
  const zoneShare = (zones ?? []).map((zone) => ({
    ...zone,
    def: HR_ZONES.find((item) => item.id === zone.id) ?? HR_ZONES[0],
    pct: total > 0 ? (zone.seconds / total) * 100 : 0,
  }));
  const stats = [decouplingStat(heart), efficiencyStat(heart), usualStat(heart)].filter(
    (stat): stat is StatCardProps => stat != null,
  );
  const peaks = peakStats(heart);
  const context = heart.usual
    ? explainHeartGap({ gapBpm: heart.usual.gapBpm, tsb, tempC: heart.avgTempC })
    : null;
  const anchors = [
    heart.maxHeartrate ? `max ${heart.maxHeartrate}` : null,
    heart.lthr ? `LTHR ${heart.lthr}` : null,
  ].filter(Boolean);

  if (!zones?.length && !stats.length && !peaks.length) return null;

  return (
    <ActivityDetailSection
      title={
        <>
          <HeartPulseIcon aria-hidden className="size-4" />
          Heart rate
        </>
      }
      description={`${heart.zoneModel}${anchors.length ? ` · ${anchors.join(" · ")} bpm` : ""}`}
    >
      {context ? (
        <Alert
          variant={
            context.tone === "warning"
              ? "warning"
              : context.tone === "positive"
                ? "success"
                : "info"
          }
        >
          <AlertTitle>{context.title}</AlertTitle>
          <AlertDescription>{context.detail}</AlertDescription>
        </Alert>
      ) : null}

      {zones?.length && total > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex h-2 w-full overflow-hidden rounded-md bg-muted">
            {zoneShare.map((zone) =>
              zone.pct > 0 ? (
                <div
                  key={zone.id}
                  className="h-full min-w-0"
                  style={{ width: `${zone.pct}%`, backgroundColor: zone.def.color }}
                  title={`${zone.def.label} ${Math.round(zone.pct)}%`}
                />
              ) : null,
            )}
          </div>
          <ItemGroup className="gap-1.5">
            {zoneShare.map((zone) => (
              <Item key={zone.id} size="xs" className="px-0">
                <ItemMedia>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: zone.def.color }}
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {zone.def.label.replace("Zone ", "Z")} · {zone.def.name}
                    <span className="font-normal text-muted-foreground">
                      {formatZoneBpm(zone, zone.id === "z5")}
                    </span>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <span className="w-14 text-right font-mono tabular-nums text-muted-foreground">
                    {formatDuration(zone.seconds)}
                  </span>
                  <span className="w-9 text-right font-mono tabular-nums">
                    {Math.round(zone.pct)}%
                  </span>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </div>
      ) : null}

      {peaks.length ? (
        <div className="grid grid-cols-3 gap-2">
          {peaks.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      ) : null}

      {stats.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      ) : null}
    </ActivityDetailSection>
  );
}
