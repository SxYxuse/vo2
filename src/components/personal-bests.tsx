"use client";

import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { CartesianGrid, ComposedChart, Line, LineChart, Scatter, XAxis, YAxis } from "recharts";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { RUN_DISTANCES } from "@/services/best-efforts.ts";
import { formatPaceClock } from "@/services/locomotion.ts";
import {
  BESTS_SPORTS,
  isNewBest,
  lowerIsBetter,
  periodYears,
  powerCurve,
  previousBest,
  progression,
  topEfforts,
  type BestsActivity,
  type BestsData,
  type BestsPeriod,
  type BestsSearch,
  type BestsSport,
  type Board,
  type RankedEffort,
} from "@/services/personal-bests.ts";

const SPORT_TAB = { running: "Runs", cycling: "Rides", swimming: "Swims" } satisfies Record<
  BestsSport,
  string
>;

const SPORT_COLOR = {
  running: "var(--color-ds-amber-700)",
  cycling: "var(--color-ds-blue-700)",
  swimming: "var(--color-ds-teal-700)",
} satisfies Record<BestsSport, string>;

/** Power durations shown as cards; the curve above them carries every other duration. */
const POWER_CARDS = [5, 60, 300, 1200, 3600];

/** Run distances are named the way runners say them; the rest read as plain km or m. */
const RUN_LABEL = new Map<number, string>(
  RUN_DISTANCES.map((metres, index) => [
    metres,
    [
      "400 m",
      "1 km",
      "1 mile",
      "2 miles",
      "5 km",
      "5 miles",
      "10 km",
      "10 miles",
      "Half marathon",
      "Marathon",
    ][index],
  ]),
);

const DAYS_LABEL = { longest: "Longest", climbing: "Most climbing", climb: "Biggest climb" };

const PERIOD_LABEL = { all: "All time", "12m": "12 months", "6w": "6 weeks" };

// A four-digit year: "Sep 26" read as the 26th, not September 2026.
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const DAY_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
/** "Sep 20" this year, "Nov 3, 2025" before it. */
function cardDate(iso: string, now: Date) {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() ? DAY_MONTH.format(date) : FULL_DATE.format(date);
}

const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = (seconds % 3600) / 60;
  return minutes ? `${hours} h ${minutes}` : `${hours} h`;
}

function shortDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

export function boardLabel(board: Pick<Board, "sport" | "kind" | "key">) {
  if (board.kind === "power") return durationLabel(board.key);
  if (board.kind !== "time") return DAYS_LABEL[board.kind];
  const known = board.sport === "running" ? RUN_LABEL.get(board.key) : undefined;
  if (known) return known;
  return board.key >= 1000 && board.sport !== "swimming"
    ? `${board.key / 1000} km`
    : `${board.key} m`;
}

function formatKm(metres: number) {
  return `${(metres / 1000).toFixed(1)} km`;
}

function formatMetres(metres: number) {
  return `${Math.round(metres).toLocaleString("en-US")} m`;
}

/** The headline number of an effort: a time, watts, or metres. */
function formatValue(board: Board, value: number) {
  if (board.kind === "time") return formatDuration(value);
  if (board.kind === "power") return `${value} W`;
  if (board.kind === "longest") {
    return board.sport === "swimming" ? formatMetres(value) : formatKm(value);
  }
  return formatMetres(value);
}

/** The line under the headline: pace, speed, W/kg, or the climb's shape. */
function formatDetail(
  board: Board,
  effort: { value: number } & Partial<RankedEffort>,
  weightKg: number | null,
) {
  if (board.kind === "time") {
    if (board.sport === "running")
      return `${formatPaceClock(effort.value / (board.key / 1000))} /km`;
    if (board.sport === "swimming")
      return `${formatPaceClock(effort.value / (board.key / 100))} /100 m`;
    return `${((board.key / effort.value) * 3.6).toFixed(1)} km/h`;
  }
  if (board.kind === "power")
    return weightKg ? `${(effort.value / weightKg).toFixed(1)} W/kg` : null;
  if (board.kind === "climb" && effort.distanceM) {
    const grade = effort.gradePct != null ? ` at ${effort.gradePct.toFixed(1)} %` : "";
    return `${formatKm(effort.distanceM)}${grade}`;
  }
  return null;
}

/** "0:19 faster" or "12 W more" than the best before it. */
function formatGain(board: Board, from: number, to: number) {
  const gain = Math.abs(to - from);
  if (board.kind === "time") return `${formatDuration(gain)} faster than your previous best`;
  return `${formatValue(board, gain)} more than your previous best`;
}

function periodLabel(period: BestsPeriod) {
  return period in PERIOD_LABEL ? PERIOD_LABEL[period as keyof typeof PERIOD_LABEL] : period;
}

function emptyText(board: Board) {
  if (board.kind === "power") return "No ride this long with power";
  if (board.kind !== "time") return "Not yet";
  const noun = { running: "run", cycling: "ride", swimming: "swim" }[board.sport];
  return `No ${noun} this long yet`;
}

type BestsViewProps = {
  data: BestsData;
  /** Older history or streams are still being copied, so a best can still change. */
  copyIncomplete: boolean;
  search: BestsSearch;
  onSearchChange: (next: BestsSearch, options?: { replace?: boolean }) => void;
};

/** Personal bests per sport: cards for every distance and duration, and a sheet per board. */
export function BestsView({ data, copyIncomplete, search, onSearchChange }: BestsViewProps) {
  // Read on every render, so a PWA resumed days later measures "New" and periods from today.
  const now = new Date();
  const sports = BESTS_SPORTS.filter((sport) =>
    data.boards.some((board) => board.sport === sport && board.efforts.length),
  );
  const years = useMemo(() => periodYears(data.activities), [data.activities]);

  if (!sports.length) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>No bests yet</EmptyTitle>
          <EmptyDescription>
            Bests come from runs, rides, and swims with a recording. Sync from Strava to fill them
            in.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const openBoard = data.boards.find((board) => board.id === search.best) ?? null;
  // A board opened from a link (Fitness, or back from an activity) brings its own tab.
  const wanted = search.sport ?? openBoard?.sport;
  const sport = wanted && sports.includes(wanted) ? wanted : sports[0];
  const period: BestsPeriod =
    search.period && (search.period in PERIOD_LABEL || years.includes(search.period as `${number}`))
      ? search.period
      : "all";
  const boards = data.boards.filter((board) => board.sport === sport);
  const ctx = { activities: data.activities, period, now, weightKg: data.weightKg };
  const open = (board: Board) => onSearchChange({ ...search, best: board.id });

  const timeBoards = boards.filter((board) => board.kind === "time").sort((a, b) => a.key - b.key);
  const powerBoards = boards.filter((board) => board.kind === "power");
  const hasPower = powerBoards.some((board) => board.efforts.length);
  const daysBoards = (["longest", "climbing", "climb"] as const).flatMap((kind) =>
    boards.filter((board) => board.kind === kind),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Tabs
          value={sport}
          onValueChange={(value) =>
            onSearchChange(
              { ...search, sport: value as BestsSport, best: undefined },
              { replace: true },
            )
          }
        >
          <TabsList>
            {sports.map((item) => (
              <TabsTrigger key={item} value={item}>
                {SPORT_TAB[item]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          value={[period]}
          onValueChange={(next) => {
            const value = next[0] as BestsPeriod | undefined;
            if (value) onSearchChange({ ...search, period: value }, { replace: true });
          }}
          className="flex-wrap"
        >
          {(["all", "12m", "6w", ...years] as BestsPeriod[]).map((item) => (
            <ToggleGroupItem key={item} value={item}>
              {periodLabel(item)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {sport === "cycling" ? (
        <Section title="Power" note="Rides with a power meter">
          {hasPower ? (
            <>
              <PowerCurveCard boards={powerBoards} {...ctx} />
              <CardGrid>
                {POWER_CARDS.map((seconds) => {
                  const board = powerBoards.find((item) => item.key === seconds);
                  return board ? (
                    <BestCard key={board.id} board={board} onOpen={open} {...ctx} />
                  ) : null;
                })}
              </CardGrid>
              {data.weightKg ? (
                <p className="text-xs text-muted-foreground">
                  W/kg divides every effort by your current weight ({data.weightKg} kg).
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No ride with a power meter yet. Power bests need watts from a power meter or a smart
              trainer.
            </p>
          )}
        </Section>
      ) : null}

      <Section
        title="Distance bests"
        note={
          sport === "running"
            ? "Road runs"
            : sport === "cycling"
              ? "Outdoor rides"
              : "Rests keep the clock running"
        }
      >
        <CardGrid>
          {timeBoards.map((board) => (
            <BestCard key={board.id} board={board} onOpen={open} {...ctx} />
          ))}
        </CardGrid>
      </Section>

      <Section
        title="Biggest days"
        note={sport === "running" ? "Trail runs count here" : undefined}
      >
        <CardGrid>
          {daysBoards.map((board) => (
            <BestCard key={board.id} board={board} onOpen={open} {...ctx} />
          ))}
        </CardGrid>
      </Section>

      <p className="text-xs text-muted-foreground">
        {copyIncomplete
          ? "VO2 is still copying your older Strava history, so these bests can still change."
          : "All time covers everything VO2 has copied from Strava."}
      </p>

      <BestSheet
        board={openBoard}
        onClose={() => onSearchChange({ ...search, best: undefined }, { replace: true })}
        {...ctx}
      />
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{children}</div>;
}

type BoardContext = {
  activities: BestsActivity[];
  period: BestsPeriod;
  now: Date;
  weightKg: number | null;
};

function BestCard({
  board,
  onOpen,
  activities,
  period,
  now,
  weightKg,
}: BoardContext & { board: Board; onOpen: (board: Board) => void }) {
  const best = topEfforts(board, activities, period, now, 1)[0];
  const fresh = best != null && isNewBest(best.activity.start, now);
  const detail = best ? formatDetail(board, best, weightKg) : null;
  const date = best ? cardDate(best.activity.start, now) : null;
  return (
    <button
      type="button"
      disabled={!best}
      onClick={() => onOpen(board)}
      className="flex min-h-24 flex-col rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-card"
    >
      <span className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
        {boardLabel(board)}
        {fresh ? (
          <Badge variant="secondary" className="h-4 bg-success/15 px-1.5 text-[10px] text-success">
            New
          </Badge>
        ) : (
          <span className="shrink-0">{date}</span>
        )}
      </span>
      <span
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          !best && "text-muted-foreground/50",
        )}
      >
        {best ? formatValue(board, best.value) : "—"}
      </span>
      <span className="mt-auto flex justify-between gap-2 pt-1 text-xs text-muted-foreground">
        <span className="truncate tabular-nums">
          {best ? (detail ?? best.activity.name) : emptyText(board)}
        </span>
        {/* The badge took the date's place at the top. */}
        {fresh ? <span className="shrink-0">{date}</span> : null}
      </span>
    </button>
  );
}

const CURVE_CONFIG = {
  allTime: { label: "All time", color: "var(--color-muted-foreground)" },
  period: { label: "Period", color: SPORT_COLOR.cycling },
} satisfies ChartConfig;

function PowerCurveCard({ boards, activities, period, now }: BoardContext & { boards: Board[] }) {
  const curve = powerCurve(boards, activities, period, now);
  const compare = period !== "all";
  const ticks = [5, 60, 300, 1200, 3600, 10800].filter(
    (tick) => tick >= curve[0]?.seconds && tick <= (curve.at(-1)?.seconds ?? 0),
  );
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <ChartContainer config={CURVE_CONFIG} className="aspect-auto h-48 w-full sm:h-60">
          <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="seconds"
              type="number"
              scale="log"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={(value) => shortDuration(Number(value))}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={["auto", "auto"]}
              width={40}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => String(Math.round(Number(value)))}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof curve)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <TooltipBox title={durationLabel(row.seconds)}>
                    {compare ? (
                      <TooltipRow
                        label={periodLabel(period)}
                        value={row.period == null ? "—" : `${row.period} W`}
                      />
                    ) : null}
                    <TooltipRow label="All time" value={`${row.allTime} W`} />
                  </TooltipBox>
                );
              }}
            />
            <Line
              dataKey="allTime"
              type="monotone"
              stroke={compare ? "var(--color-allTime)" : "var(--color-period)"}
              strokeWidth={2}
              strokeDasharray={compare ? "4 3" : undefined}
              dot={false}
              isAnimationActive={false}
            />
            {compare ? (
              <Line
                dataKey="period"
                type="monotone"
                stroke="var(--color-period)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
          </LineChart>
        </ChartContainer>
        <p className="text-xs text-muted-foreground">
          {compare
            ? `Best average power at each duration. Solid: ${periodLabel(period).toLowerCase()}. Dashed: all time.`
            : "Best average power you have held at each duration."}
        </p>
      </CardContent>
    </Card>
  );
}

function TooltipBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-32 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{title}</div>
      {children}
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function BestSheet({
  board,
  onClose,
  ...ctx
}: BoardContext & { board: Board | null; onClose: () => void }) {
  // On desktop the top 10 sits beside the chart, so the dialog widens when there is one.
  const charted = board != null && hasProgressionChart(board, ctx);
  return (
    <ResponsiveDialog open={board != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <ResponsiveDialogContent
        className={cn(
          "flex max-h-[92dvh] flex-col gap-0 overflow-hidden sm:max-w-lg",
          charted && "md:max-w-4xl",
        )}
      >
        {board ? <BestSheetBody board={board} {...ctx} /> : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function hasProgressionChart(board: Board, { activities, period, now }: BoardContext) {
  return progression(board, activities, period, now).length > 1;
}

function BestSheetBody({
  board,
  activities,
  period,
  now,
  weightKg,
}: BoardContext & { board: Board }) {
  const top = topEfforts(board, activities, period, now);
  const points = progression(board, activities, period, now);
  const best = top[0];
  const before = previousBest(points);
  const label = boardLabel(board);
  const detail = best ? formatDetail(board, best, weightKg) : null;
  return (
    <>
      <ResponsiveDialogHeader className="text-left">
        <ResponsiveDialogDescription>
          {label} ·{" "}
          {period === "all" ? "personal best" : `best in ${periodLabel(period).toLowerCase()}`}
        </ResponsiveDialogDescription>
        <ResponsiveDialogTitle className="text-4xl font-bold tracking-tight tabular-nums">
          {best ? formatValue(board, best.value) : "—"}
        </ResponsiveDialogTitle>
        {best ? (
          <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
            <span>
              {[detail, best.activity.name, FULL_DATE.format(new Date(best.activity.start))]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {before ? (
              <span className="font-medium text-success">
                {formatGain(board, before.value, best.value)}
              </span>
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialogHeader>
      {/* The drawer pads its header but not its body; the desktop dialog pads both. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:flex-row md:items-start md:gap-6 md:px-0 md:pb-0">
        {points.length > 1 ? (
          <section className="flex flex-col gap-2 md:min-w-0 md:flex-1">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Progression</h3>
              <span className="text-xs text-muted-foreground">
                {points.length}{" "}
                {board.kind === "time" || board.kind === "power" ? "efforts" : "activities"}
              </span>
            </div>
            <ProgressionChart board={board} points={points} />
          </section>
        ) : null}
        <section
          className={cn(
            "flex flex-col gap-1 md:flex-1",
            points.length > 1 && "md:w-80 md:flex-none",
          )}
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Top {Math.min(top.length, 10)}</h3>
            <span className="text-xs text-muted-foreground">One per activity</span>
          </div>
          <ol className="flex flex-col">
            {top.map((effort) => (
              <li key={effort.activity.id} className="border-b last:border-b-0">
                <Link
                  to="/activities/$activityId"
                  params={{ activityId: effort.activity.id }}
                  search={{ from: "bests", best: board.id, period }}
                  className="grid min-h-12 grid-cols-[1.75rem_1fr_auto_1rem] items-center gap-2 py-2 hover:bg-accent/40"
                >
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
                      effort.rank === 1 ? "bg-foreground text-background" : "text-muted-foreground",
                    )}
                  >
                    {effort.rank}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{effort.activity.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {FULL_DATE.format(new Date(effort.activity.start))}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatValue(board, effort.value)}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {formatDetail(board, effort, weightKg)}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function ProgressionChart({
  board,
  points,
}: {
  board: Board;
  points: ReturnType<typeof progression>;
}) {
  const config = {
    value: { label: boardLabel(board), color: SPORT_COLOR[board.sport] },
    bestSoFar: { label: "Best so far", color: "var(--color-foreground)" },
  } satisfies ChartConfig;
  const data = points.map((point) => ({ ...point, t: new Date(point.start).getTime() }));
  // Over a few months, month ticks would repeat; name the day instead.
  const short = (data.at(-1)?.t ?? 0) - (data[0]?.t ?? 0) < 120 * 86_400_000;
  const tickFormat = short ? DAY_MONTH : MONTH_YEAR;
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-48 w-full sm:h-56">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value) => tickFormat.format(new Date(Number(value)))}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            reversed={lowerIsBetter(board.kind)}
            domain={["auto", "auto"]}
            width={52}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatValue(board, Math.round(Number(value)))}
          />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              return (
                <TooltipBox title={FULL_DATE.format(new Date(row.t))}>
                  <TooltipRow label={boardLabel(board)} value={formatValue(board, row.value)} />
                  <TooltipRow label="Best so far" value={formatValue(board, row.bestSoFar)} />
                </TooltipBox>
              );
            }}
          />
          <Scatter
            dataKey="value"
            fill="var(--color-value)"
            fillOpacity={0.55}
            isAnimationActive={false}
          />
          <Line
            dataKey="bestSoFar"
            type="stepAfter"
            stroke="var(--color-bestSoFar)"
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Dots: every effort. Line: your best so far, so each step up is a new best.
      </p>
    </>
  );
}
