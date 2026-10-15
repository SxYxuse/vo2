"use client";

import { useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";

import { formatSportType, type CalendarSettings } from "#/services/calendar-settings.types.ts";
import {
  ALL_SPORTS,
  HR_ZONES,
  formatHmm,
  formatZoneBpm,
  lthrHint,
  lthrInfo,
  overallFromSports,
  type HeartRateData,
  type HeartRateSport,
} from "#/services/heart-rate.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const DATE_MED = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

const MAX_HR_INFO =
  "Highest plausible heart rate recorded for this selection. Spikes outside 40–230 bpm are ignored. Grouped ride or run types share one max. A ride peak does not set run zones.";

const TIME_INFO =
  "Time spent in each zone from heart-rate streams. Each sample is classified with that activity's sport model, then All sums those times. Activities without heart-rate samples are left out of the bars.";

function Kpi({
  label,
  value,
  hint,
  info,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  info: string;
  color?: string;
}) {
  return (
    <Card size="sm" className="gap-1 py-3">
      <CardHeader className="px-3">
        <CardDescription className="flex items-center gap-1">
          {color ? (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          ) : null}
          <span className="min-w-0">{label}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`About ${label}`}
                />
              }
            >
              <InfoIcon />
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{info}</TooltipContent>
          </Tooltip>
        </CardDescription>
        <CardTitle className="font-mono text-base tabular-nums sm:text-lg">{value}</CardTitle>
        {hint ? <CardDescription className="line-clamp-2">{hint}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}

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
  if (!sport.peakActivityName || !sport.peakActivityStart) return undefined;
  const date = DATE_MED.format(new Date(sport.peakActivityStart));
  return `${sport.peakActivityName} · ${date}`;
}

export function HeartRateZones({
  data,
  sportTypes,
}: {
  data: HeartRateData;
  sportTypes: CalendarSettings["sportTypes"];
}) {
  const [sportType, setSportType] = useState(ALL_SPORTS);
  const sports = useMemo(
    () =>
      data.sports.filter((sport) => {
        const types = sport.members.length ? sport.members : [sport.sportType];
        return types.some((type) => sportTypes[type]?.visible !== false);
      }),
    [data.sports, sportTypes],
  );
  const overall = useMemo(() => overallFromSports(sports), [sports]);
  const selectedType = sports.some((sport) => sport.sportType === sportType)
    ? sportType
    : ALL_SPORTS;
  const selected =
    selectedType === ALL_SPORTS
      ? overall
      : (sports.find((sport) => sport.sportType === selectedType) ?? overall);
  const totalSeconds = selected.sampleSeconds;
  const zoneShare = selected.zones.map((zone) => ({
    ...zone,
    def: HR_ZONES.find((item) => item.id === zone.id) ?? HR_ZONES[0],
    pct: totalSeconds > 0 ? (zone.seconds / totalSeconds) * 100 : 0,
  }));

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

  return (
    <div className="flex flex-col gap-4">
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
                backgroundColor: sportTypes[sport.sportType]?.color ?? "var(--color-ds-gray-700)",
              }}
            />
            {sportLabel(sport)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi
          label="Max HR"
          value={selected.maxHeartrate ? `${selected.maxHeartrate} bpm` : "—"}
          hint={peakHint(selected)}
          info={MAX_HR_INFO}
          color="var(--color-ds-red-700)"
        />
        <Kpi
          label="Est. LTHR"
          value={selected.lthr ? `${selected.lthr} bpm` : "—"}
          hint={lthrHint(selected)}
          info={lthrInfo(selected)}
          color="var(--color-ds-amber-700)"
        />
        <Kpi
          label="Activities"
          value={String(selected.activityCount)}
          hint="with heart rate"
          info="Count of activities that recorded a heart rate for this selection."
          color="var(--color-ds-blue-700)"
        />
        <Kpi
          label="Time with HR"
          value={formatHmm(selected.sampleSeconds)}
          hint="from streams"
          info={TIME_INFO}
          color="var(--color-ds-teal-700)"
        />
      </div>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center gap-1">
            <CardTitle>Estimated zones</CardTitle>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="About estimated zones"
                  />
                }
              >
                <InfoIcon />
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                Cycling uses Coggan % of LTHR, running uses Friel % of LTHR, swimming uses swim LTHR
                bands, walking uses % of max HR. All adds each sport&apos;s time in zone — it does
                not re-bin every sample against one global max.
              </TooltipContent>
            </Tooltip>
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
                <EmptyTitle>No time in zone yet</EmptyTitle>
                <EmptyDescription>
                  Max HR can come from activity summaries. Time in zone needs heart-rate streams.
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
              <ItemGroup className="gap-3">
                {zoneShare.map((zone) => (
                  <Item key={zone.id} size="sm" className="flex-col items-stretch gap-1.5 px-0">
                    <ItemContent className="gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: zone.def.color }}
                        />
                        <ItemTitle>
                          {zone.def.label} · {zone.def.name}
                        </ItemTitle>
                        <Badge variant="outline">{formatZoneBpm(zone, zone.id === "z5")}</Badge>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`About ${zone.def.label}`}
                              />
                            }
                          >
                            <InfoIcon />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72">{zone.def.info}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2">
                        <ItemDescription className="w-14 shrink-0 font-mono tabular-nums">
                          {formatHmm(zone.seconds)}
                        </ItemDescription>
                        <span className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-md">
                          <span
                            className="block h-full rounded-md"
                            style={{
                              width: `${Math.max(zone.pct, zone.seconds > 0 ? 0.5 : 0)}%`,
                              backgroundColor: zone.def.color,
                            }}
                          />
                        </span>
                        <ItemDescription className="w-8 shrink-0 text-right font-mono tabular-nums">
                          {Math.round(zone.pct)}%
                        </ItemDescription>
                      </div>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
