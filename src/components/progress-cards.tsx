"use client";

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { InfoTooltip } from "@/components/tap-tooltip.tsx";
import { boardId } from "@/services/personal-bests.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { progressQueryOptions } from "@/lib/queries.ts";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { formatPaceClock } from "@/services/locomotion.ts";
import {
  bestChangePct,
  efficiencyVerdict,
  type BestRow,
  type EfficiencyComparison,
  type ProgressSport,
  type SportProgress,
} from "@/services/progress.ts";

const SPORT_TITLE = { cycling: "Rides", running: "Runs" } satisfies Record<ProgressSport, string>;

const SAME_HR_INFO = {
  cycling:
    "Normalized power per heartbeat on easy and steady rides with a power meter, read at one heart rate. More watts for the same heart rate means your aerobic engine is growing. Heat, fatigue, and sleep move it too, so look at the trend over weeks.",
  running:
    "Speed per heartbeat on easy and steady flat runs, read at one heart rate. A faster pace for the same heart rate means your aerobic engine is growing. Heat, fatigue, and sleep move it too, so look at the trend over weeks.",
} satisfies Record<ProgressSport, string>;

const BESTS_INFO =
  "Your best average power over each duration, or your fastest time over each distance, inside any activity. A best only moves when you go hard: an easy block sets none, and that is not a loss.";

const POWER_LABEL: Record<number, string> = {
  60: "1 min",
  300: "5 min",
  1200: "20 min",
  3600: "1 h",
};
const RUN_LABEL: Record<number, string> = {
  1000: "1 km",
  5000: "5 km",
  10000: "10 km",
  21097.5: "Half",
};

const DATE_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });

function formatOutput(output: number, sport: ProgressSport) {
  // Run output is metres per minute.
  return sport === "cycling" ? `${Math.round(output)} W` : `${formatPaceClock(60000 / output)} /km`;
}

function formatBest(value: number | null, sport: ProgressSport) {
  if (value == null) return "—";
  return sport === "cycling" ? `${value} W` : formatDuration(value);
}

function changeTone(change: number | null) {
  if (change == null) return "text-muted-foreground";
  if (change >= 2) return "text-success";
  if (change <= -2) return "text-warning";
  return "text-muted-foreground";
}

function signedPct(change: number) {
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)} %`;
}

function SameHeartRate({
  comparison,
  sport,
}: {
  comparison: EfficiencyComparison | null;
  sport: ProgressSport;
}) {
  const verdict = comparison ? efficiencyVerdict(comparison) : null;
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-medium">Easier than before?</h3>
        <InfoTooltip label="About output at the same heart rate">{SAME_HR_INFO[sport]}</InfoTooltip>
      </div>
      {!comparison?.now ? (
        <p className="text-muted-foreground text-sm">
          {sport === "cycling"
            ? "Needs three easy or steady rides of 20 minutes or more with power and heart rate in the last six weeks."
            : "Needs three easy or steady flat runs of 20 minutes or more with heart rate in the last six weeks."}
        </p>
      ) : (
        <>
          <p className="text-base font-medium tabular-nums">
            At {comparison.referenceBpm} bpm: {formatOutput(comparison.now.output, sport)}
          </p>
          <p className="text-muted-foreground text-sm">
            {comparison.before ? (
              <>
                6 weeks before: {formatOutput(comparison.before.output, sport)}
                {comparison.changePct != null ? (
                  <span className={cn("ml-2", changeTone(comparison.changePct))}>
                    {signedPct(comparison.changePct)}
                  </span>
                ) : null}
              </>
            ) : (
              "Not enough sessions in the six weeks before to compare."
            )}
          </p>
          {verdict ? <p className="text-muted-foreground text-sm">{verdict.text}</p> : null}
        </>
      )}
    </section>
  );
}

function BestEfforts({ rows, sport }: { rows: BestRow[]; sport: ProgressSport }) {
  const labels = sport === "cycling" ? POWER_LABEL : RUN_LABEL;
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-medium">What you can do</h3>
        <InfoTooltip label="About best efforts">{BESTS_INFO}</InfoTooltip>
        <Link
          to="/bests"
          search={{ sport }}
          className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          All bests
        </Link>
      </div>
      {!rows.length ? (
        <p className="text-muted-foreground text-sm">
          {sport === "cycling"
            ? "No ride with a power stream in the last year yet."
            : "No run with a distance stream in the last year yet."}
        </p>
      ) : (
        <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
          <span />
          <span className="text-muted-foreground text-right text-xs">Last 6 wks</span>
          <span className="text-muted-foreground text-right text-xs">6 wks before</span>
          <span className="text-muted-foreground text-right text-xs">Best 12 mo</span>
          {rows.map((row) => {
            const change = bestChangePct(row, sport);
            return (
              <div key={row.key} className="contents">
                <Link
                  to="/bests"
                  search={{
                    sport,
                    best: boardId(sport, sport === "cycling" ? "power" : "time", row.key),
                  }}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {labels[row.key]}
                </Link>
                <span className="text-right tabular-nums">
                  {formatBest(row.now, sport)}
                  {change != null ? (
                    <span className={cn("block text-xs", changeTone(change))}>
                      {signedPct(change)}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-right tabular-nums">
                  {formatBest(row.before, sport)}
                </span>
                <span className="text-right tabular-nums">
                  {formatBest(row.year, sport)}
                  {row.yearStart ? (
                    <span className="text-muted-foreground block text-xs">
                      {DATE_SHORT.format(new Date(row.yearStart))}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SportProgressCard({ progress }: { progress: SportProgress }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{SPORT_TITLE[progress.sport]}</CardTitle>
        <CardDescription>The last six weeks against the six weeks before.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <SameHeartRate comparison={progress.efficiency} sport={progress.sport} />
        <BestEfforts rows={progress.bests} sport={progress.sport} />
      </CardContent>
    </Card>
  );
}

/** Whether training is paying off: capacity and cost, next to the load graph above. */
export function ProgressCards() {
  const { data, isPending, isError } = useQuery(progressQueryOptions);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Progress</h2>
        <p className="text-muted-foreground text-sm">
          Are you getting better? What you can do now, and what it costs your heart.
        </p>
      </div>
      {isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : isError ? (
        <Empty className="min-h-32 border">
          <EmptyHeader>
            <EmptyTitle>Could not load progress</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : !data.sports.length ? (
        <Empty className="min-h-32 border">
          <EmptyHeader>
            <EmptyTitle>Nothing to compare yet</EmptyTitle>
            <EmptyDescription>
              Progress compares rides with a power meter and runs. Sync a few of either to see it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.sports.map((progress) => (
            <SportProgressCard key={progress.sport} progress={progress} />
          ))}
        </div>
      )}
    </div>
  );
}
