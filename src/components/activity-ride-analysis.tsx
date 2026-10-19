import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SERIES_META } from "@/components/activity-detail-series.ts";
import { formatDuration } from "@/services/activity-detail.ts";
import {
  variabilityLabel,
  type RideGradeBand,
  type RideSummary,
} from "@/services/ride-analysis.ts";

function formatGradeRange(band: RideGradeBand) {
  if (band.minGrade <= -100) return `< ${band.maxGrade} %`;
  if (band.maxGrade >= 100) return `> ${band.minGrade} %`;
  return `${band.minGrade} to ${band.maxGrade} %`;
}

function formatNumber(value: number | null, digits = 0) {
  return value == null ? "—" : value.toFixed(digits);
}

type RideStatProps = { label: string; value: string; hint?: string; info: string };

const STAT_INFO = {
  intensity:
    "Intensity factor: normalized power divided by your FTP. 0.75 is endurance, 0.85–0.95 tempo to sweet spot, 1.0 is a one-hour all-out effort.",
  tss: "Training stress score: how costly the ride was, from duration and intensity. One hour at FTP is 100. It feeds your fitness and fatigue.",
  variability:
    "Variability index: normalized power divided by average power. Near 1.00 is steady pacing, like a time trial; above 1.15 is surgy, like group rides, crits, or punchy terrain.",
  coasting:
    "Share of moving time with zero cadence: descents, drafting, and freewheeling. High coasting lowers average power but not the cost of the hard parts.",
} as const;

function RideStat({ label, value, hint, info }: RideStatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md px-3 py-2">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        <InfoTooltip label={`${label}`}>{info}</InfoTooltip>
      </span>
      <span className="font-mono text-base tabular-nums">{value}</span>
      {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function rideStats(ride: RideSummary) {
  const stats: RideStatProps[] = [];
  if (ride.intensityFactor != null) {
    stats.push({
      label: "Intensity",
      value: ride.intensityFactor.toFixed(2),
      hint: "NP ÷ FTP",
      info: STAT_INFO.intensity,
    });
  }
  if (ride.tss != null) {
    stats.push({
      label: "TSS",
      value: String(Math.round(ride.tss)),
      hint: "Training stress",
      info: STAT_INFO.tss,
    });
  }
  if (ride.variabilityIndex != null) {
    stats.push({
      label: "Variability",
      value: ride.variabilityIndex.toFixed(2),
      hint: variabilityLabel(ride.variabilityIndex),
      info: STAT_INFO.variability,
    });
  }
  if (ride.coastingPct != null) {
    stats.push({
      label: "Coasting",
      value: `${Math.round(ride.coastingPct)} %`,
      hint: "Moving, not pedaling",
      info: STAT_INFO.coasting,
    });
  }
  return stats;
}

export function ActivityRideAnalysis({ ride }: { ride: RideSummary }) {
  const stats = rideStats(ride);
  const totalSec = ride.bands.reduce((sum, band) => sum + band.durationSec, 0);
  const showHeartrate = ride.bands.some((band) => band.avgHeartrate != null);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Ride by terrain
          {ride.estimatedPower ? <Badge variant="warning">Estimated power</Badge> : null}
        </CardTitle>
        <CardDescription>
          Moving time split by gradient: what you pushed and how fast you spun on each slope.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stats.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((stat) => (
              <RideStat key={stat.label} {...stat} />
            ))}
          </div>
        ) : null}

        {ride.bands.length ? (
          <Table className="font-mono tabular-nums">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-sans">Terrain</TableHead>
                <TableHead className="text-right font-sans">Time</TableHead>
                {ride.hasPower ? (
                  <TableHead className="text-right font-sans">
                    <BandUnit color={SERIES_META.watts.color} unit="W" />
                  </TableHead>
                ) : null}
                {ride.hasCadence ? (
                  <TableHead className="text-right font-sans">
                    <BandUnit color={SERIES_META.cadence.color} unit="rpm" />
                  </TableHead>
                ) : null}
                <TableHead className="text-right font-sans">
                  <BandUnit color={SERIES_META.speed.color} unit="km/h" />
                </TableHead>
                {showHeartrate ? (
                  <TableHead className="hidden text-right font-sans sm:table-cell">
                    <BandUnit color={SERIES_META.heartrate.color} unit="bpm" />
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ride.bands.map((band) => {
                const share = totalSec > 0 ? (band.durationSec / totalSec) * 100 : 0;
                return (
                  <TableRow key={band.label} className="hover:bg-transparent">
                    <TableCell className="py-2 font-sans">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{band.label}</span>
                        <span className="text-muted-foreground">{formatGradeRange(band)}</span>
                        <span aria-hidden className="h-1 w-full rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${share}%`,
                              backgroundColor: SERIES_META.altitude.color,
                            }}
                          />
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right align-top">
                      <div>{formatDuration(band.durationSec)}</div>
                      <div className="text-muted-foreground">{Math.round(share)} %</div>
                    </TableCell>
                    {ride.hasPower ? (
                      <TableCell className="py-2 text-right align-top">
                        {formatNumber(band.avgWatts)}
                      </TableCell>
                    ) : null}
                    {ride.hasCadence ? (
                      <TableCell className="py-2 text-right align-top">
                        <div>{formatNumber(band.avgCadence)}</div>
                        {band.coastingPct ? (
                          <div className="text-muted-foreground">{band.coastingPct} % coast</div>
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="py-2 text-right align-top">
                      {formatNumber(band.avgSpeedKmh, 1)}
                    </TableCell>
                    {showHeartrate ? (
                      <TableCell className="hidden py-2 text-right align-top sm:table-cell">
                        {formatNumber(band.avgHeartrate)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground">No elevation data to split this ride by gradient.</p>
        )}
      </CardContent>
    </Card>
  );
}

function BandUnit({ color, unit }: { color: string; unit: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {unit}
    </span>
  );
}
