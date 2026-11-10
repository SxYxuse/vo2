"use client";

import { useMemo, useState } from "react";

import { useTrainingPeriod } from "@/hooks/use-training-period.ts";
import {
  formatSportType,
  sportTypeColor,
  type AthleteSettings,
} from "@/services/athlete-settings.types.ts";
import { maxHrAnchorHint, maxHrAnchorInfo } from "@/services/heart-insights.ts";
import {
  ALL_SPORTS,
  HR_ZONES,
  formatHmm,
  formatZoneBpm,
  lthrHint,
  lthrInfo,
  overallFromSports,
  sportForPeriod,
  type HeartRateData,
  type HeartRateSport,
} from "@/services/heart-rate.ts";
import { FITNESS_PERIODS, periodStartMs } from "@/services/training-load.ts";
import { EfficiencyTrendCard } from "@/components/heart-rate-efficiency.tsx";
import { HeartRateReportCard } from "@/components/heart-rate-report.tsx";
import { PeriodToggle } from "@/components/period-toggle.tsx";
import { StatCard, StatGrid } from "@/components/stat-card.tsx";
import {
  InfoTooltip,
  TapTooltip,
  TapTooltipContent,
  TapTooltipTrigger,
} from "@/components/tap-tooltip.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DATE_MED = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

const MAX_HR_INFO =
  "Highest heart rate across sports from the last 18 months, with sensor spikes left out. Each sport keeps its own max: a ride peak does not set run zones. Open a sport to see how its max compares with your age.";

const TIME_INFO =
  "Time spent in each zone from heart-rate streams, in the selected period. Each sample is classified with that activity's sport model, then All sums those times. Activities without heart-rate samples are left out of the bars.";

function sportLabel(sport: HeartRateSport | string) {
  const sportType = typeof sport === "string" ? sport : sport.sportType;
  return sportType === ALL_SPORTS ? "All" : formatSportType(sportType);
}

function membersHint(sport: HeartRateSport) {
  if (sport.members.length < 2) return null;
  const extras = sport.members.filter((member) => member !== sport.sportType);
  if (!extras.length) return null;
  return `Includes ${extras.map(formatSportType).join(", ")}`;
}

function peakHint(sport: HeartRateSport) {
  const anchorHint = sport.maxAnchor ? maxHrAnchorHint(sport.maxAnchor) : null;
  if (anchorHint) return anchorHint;
  if (!sport.peakActivityName || !sport.peakActivityStart) return undefined;
  const date = DATE_MED.format(new Date(sport.peakActivityStart));
  return `${sport.peakActivityName} · ${date}`;
}

export function HeartRateZones({
  data,
  sportTypes,
}: {
  data: HeartRateData;
  sportTypes: AthleteSettings["sportTypes"];
}) {
  const [sportType, setSportType] = useState(ALL_SPORTS);
  const period = useTrainingPeriod();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const startMs = period ? periodStartMs(period, timeZone) : null;
  const periodLabel = FITNESS_PERIODS.find((item) => item.id === period)?.label;
  const sports = useMemo(
    () => data.sports.map((sport) => sportForPeriod(sport, startMs)),
    [data.sports, startMs],
  );
  const overall = useMemo(() => overallFromSports(sports), [sports]);
  const selectedType = sports.some((sport) => sport.sportType === sportType)
    ? sportType
    : ALL_SPORTS;
  const selected =
    selectedType === ALL_SPORTS
      ? overall
      : (sports.find((sport) => sport.sportType === selectedType) ?? overall);
  if (!data.overall.activityCount) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>No heart-rate data yet</EmptyTitle>
          <EmptyDescription>
            Sync activities with a chest strap or optical HR so we can estimate zones and time in
            zone.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (sports.length === 0) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>No activity types enabled</EmptyTitle>
          <EmptyDescription>
            Turn on at least one activity type in settings to see heart-rate zones.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const totalSeconds = selected.sampleSeconds;
  const zoneShare = selected.zones.map((zone) => ({
    ...zone,
    def: HR_ZONES.find((item) => item.id === zone.id) ?? HR_ZONES[0],
    pct: totalSeconds > 0 ? (zone.seconds / totalSeconds) * 100 : 0,
  }));

  return (
    <div className="flex flex-col gap-4">
      <PeriodToggle period={period} />
      <ToggleGroup
        size="sm"
        variant="outline"
        spacing={0}
        value={[selectedType]}
        onValueChange={(next) => {
          const value = next[0];
          if (value) setSportType(value);
        }}
        className="flex-wrap"
      >
        <ToggleGroupItem value={ALL_SPORTS}>All</ToggleGroupItem>
        {sports.map((sport) => (
          <ToggleGroupItem key={sport.sportType} value={sport.sportType}>
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{
                backgroundColor: sportTypeColor(sportTypes, sport.sportType),
              }}
            />
            {sportLabel(sport)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <StatGrid className={selected.lthr ? "lg:grid-cols-4" : "lg:grid-cols-3"}>
        <StatCard
          hintClassName="line-clamp-2"
          label="Max HR"
          value={selected.maxHeartrate ? `${selected.maxHeartrate} bpm` : "—"}
          hint={peakHint(selected)}
          info={selected.maxAnchor ? maxHrAnchorInfo(selected.maxAnchor) : MAX_HR_INFO}
          color="var(--color-ds-red-700)"
        />
        {/* All sports together have no one threshold: the tile shows once a sport is picked. */}
        {selected.lthr ? (
          <StatCard
            hintClassName="line-clamp-2"
            label={selected.lthrSource === "athlete" ? "LTHR" : "Est. LTHR"}
            value={`${selected.lthr} bpm`}
            hint={lthrHint(selected)}
            info={lthrInfo(selected)}
            color="var(--color-ds-amber-700)"
          />
        ) : null}
        <StatCard
          hintClassName="line-clamp-2"
          label="Activities"
          value={String(selected.activityCount)}
          hint={period === "all" || !periodLabel ? "with heart rate" : `in ${periodLabel}`}
          info="Count of activities that recorded a heart rate for this selection."
          color="var(--color-ds-blue-700)"
        />
        <StatCard
          hintClassName="line-clamp-2"
          label="Time with HR"
          value={formatHmm(selected.sampleSeconds)}
          hint="from streams"
          info={TIME_INFO}
          color="var(--color-ds-teal-700)"
        />
      </StatGrid>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center gap-1">
            <CardTitle>Estimated zones</CardTitle>
            <InfoTooltip label="About estimated zones">
              Cycling uses Coggan % of LTHR, running uses Friel % of LTHR, swimming uses swim LTHR
              bands, walking uses % of max HR. All adds each sport&apos;s time in zone — it does not
              re-bin every sample against one global max.
            </InfoTooltip>
          </div>
          <CardDescription>
            {sportLabel(selected)} · {selected.zoneModel}
            {membersHint(selected) ? ` · ${membersHint(selected)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {totalSeconds <= 0 ? (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyTitle>
                  {selected.activityCount ? "No time in zone yet" : "No heart rate in this period"}
                </EmptyTitle>
                <EmptyDescription>
                  {selected.activityCount
                    ? "Max HR can come from activity summaries. Time in zone needs heart-rate streams."
                    : "Pick a longer period to see time in zone."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
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
              <ul className="flex flex-col">
                {zoneShare.map((zone) => {
                  const bpm = formatZoneBpm(zone, zone.id === "z5");
                  return (
                    <li
                      key={zone.id}
                      className="grid min-h-11 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3rem_2.25rem] items-center gap-x-3 py-1"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: zone.def.color }}
                        />
                        <div className="flex min-w-0 flex-col">
                          <TapTooltip>
                            <TapTooltipTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label={`${zone.def.label} · ${zone.def.name}`}
                                  className="decoration-muted-foreground/50 truncate text-left text-sm font-medium underline decoration-dotted underline-offset-4"
                                />
                              }
                            >
                              {zone.def.label.replace("Zone ", "Z")} {zone.def.name}
                            </TapTooltipTrigger>
                            <TapTooltipContent className="max-w-72">
                              {zone.def.info}
                            </TapTooltipContent>
                          </TapTooltip>
                          {bpm === "per sport" ? null : (
                            <span className="text-muted-foreground truncate text-xs tabular-nums">
                              {bpm}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(zone.pct, zone.seconds > 0 ? 0.5 : 0)}%`,
                            backgroundColor: zone.def.color,
                          }}
                        />
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {formatHmm(zone.seconds)}
                      </span>
                      <span className="text-muted-foreground text-right text-xs tabular-nums">
                        {Math.round(zone.pct)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      {period ? <HeartRateReportCard sport={selected} period={period} /> : null}
      {selected.efficiencyKind && period ? (
        <EfficiencyTrendCard sport={selected} period={period} />
      ) : null}
    </div>
  );
}
