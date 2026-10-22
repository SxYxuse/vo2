"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleIcon,
  MoonIcon,
  PauseIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";

import { settingsSnapshotQueryOptions, weekTargetQueryOptions } from "@/lib/queries.ts";
import { PHASES, type SeasonPhase } from "@/services/season-phase.ts";
import {
  addDayKey,
  formatHours,
  keySessionName,
  saveKeySessionSport,
} from "@/services/training-plan.ts";
import { withKeySessionSport, type TrainingPlan } from "@/services/training-plan.types.ts";
import {
  AVAILABLE_WINDOWS,
  HISTORY_WEEKS,
  defaultWindow,
  projectWeek,
  DAY_SPORTS,
  MAX_DAY_PARTS,
  TODAY_FEELS,
  SPLIT_MIN_MINUTES,
  customSplit,
  isDefaultChoice,
  isTodayComplete,
  recommendToday,
  sessionSteps,
  summarizeWeek,
  todayActivities,
  type PaceStatus,
  type DayPart,
  type DaySport,
  type KeySessionStatus,
  type TodayChoice,
  type WeekActivity,
  type WeekSummary,
  type WeekTargetData,
} from "@/services/week-target.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SessionStrip } from "@/components/session-detail.tsx";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type PlannedWeek = WeekTargetData & { plan: TrainingPlan };

const STATUS_BADGE: Record<
  PaceStatus,
  { label: string; variant: "success" | "info" | "warning" | "outline" }
> = {
  done: { label: "Target met", variant: "success" },
  ahead: { label: "Ahead", variant: "success" },
  "on-track": { label: "On track", variant: "info" },
  behind: { label: "Behind", variant: "warning" },
};

const FAMILY_STYLE = SPORT_STYLE;

function weekRangeLabel(weekStart: string) {
  const start = parseISO(`${weekStart}T12:00:00`);
  const end = parseISO(`${addDayKey(weekStart, 6)}T12:00:00`);
  return `${format(start, "MMM d")}–${format(end, "MMM d")}`;
}

function signed(value: number) {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return "0";
}

function minutesLabel(minutes: number) {
  return formatHours(minutes / 60);
}

function targetSourceLabel(summary: WeekSummary, season: SeasonPhase) {
  const phase = PHASES[season.kind].label.toLowerCase();
  if (summary.target.source === "auto") return `Set from your fitness and the ${phase} phase.`;
  if (summary.target.source === "no-history") {
    return "Starting hours until VO2 has enough history to set it from your fitness.";
  }
  return `Capped at the hours you have; the ${phase} phase asks for more.`;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

function TargetCard({ data, summary }: { data: PlannedWeek; summary: WeekSummary }) {
  const { target, doneMinutes, remainingMinutes, pace } = summary;
  const filled = target.minutes > 0 ? Math.min(1, doneMinutes / target.minutes) : 0;
  const expected = target.minutes > 0 ? Math.min(1, pace.expectedMinutes / target.minutes) : 0;
  const status = STATUS_BADGE[pace.status];

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Week target
          <Badge variant="outline">{weekRangeLabel(data.weekStart)}</Badge>
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardTitle>
        <CardDescription>{targetSourceLabel(summary, data.season)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
            {remainingMinutes > 0 ? minutesLabel(remainingMinutes) : minutesLabel(doneMinutes)}
          </span>
          <span className="text-muted-foreground text-sm">
            {remainingMinutes > 0
              ? `left of ${minutesLabel(target.minutes)}`
              : `done · target was ${minutesLabel(target.minutes)}`}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="relative h-2.5 w-full rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                pace.status === "behind" ? "bg-warning" : "bg-success",
              )}
              style={{ width: `${filled * 100}%` }}
            />
            {expected > 0 && remainingMinutes > 0 ? (
              <div
                aria-hidden
                className="bg-foreground absolute -top-1 h-4.5 w-0.5 rounded-full"
                style={{ left: `calc(${expected * 100}% - 1px)` }}
              />
            ) : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs">
            <span>{minutesLabel(doneMinutes)} done</span>
            {expected > 0 && remainingMinutes > 0 ? (
              <span>
                {pace.fromHistory ? "Usual you by now" : "Even pace by now"}:{" "}
                {minutesLabel(pace.expectedMinutes)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Days left"
            value={summary.daysLeft}
            hint={summary.restDayAhead && summary.daysLeft > 1 ? "Rest day included" : undefined}
          />
          <Stat
            label="Per training day"
            value={remainingMinutes > 0 ? minutesLabel(summary.perDayMinutes) : "—"}
            hint={`Over ${summary.trainingDaysLeft} ${summary.trainingDaysLeft === 1 ? "day" : "days"}`}
          />
          <Stat
            label="Training load"
            value={`${summary.doneLoad} / ${summary.target.load}`}
            hint={`${summary.remainingLoad} left`}
          />
          <Stat
            label="Form now"
            value={signed(summary.form)}
            hint={summary.form < -30 ? "Very fatigued" : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SplitBar({
  label,
  icon: Icon,
  iconClass,
  barClass,
  done,
  left,
  max,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  barClass: string;
  done: number;
  left: number;
  max: number;
}) {
  const total = done + left;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <Icon className={cn("size-4", iconClass)} />
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums">
          {left > 0 ? `${minutesLabel(left)} left` : done > 0 ? "Done" : "None planned"}
          <span className="text-muted-foreground"> · {minutesLabel(done)} done</span>
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={barClass} style={{ width: `${(done / max) * 100}%` }} />
        <div
          className={cn(barClass, "opacity-30")}
          style={{ width: `${(Math.max(0, total - done) / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

const KEY_SPORTS = [
  { id: "cycling", label: "Ride" },
  { id: "running", label: "Run" },
] as const;

type KeySport = (typeof KEY_SPORTS)[number]["id"];

/** Ride or run for one key session. Picking VO2's suggestion clears the athlete's own pick. */
function KeySportPicker({ status }: { status: KeySessionStatus }) {
  const queryClient = useQueryClient();
  const id = status.session.id;
  const save = useMutation({
    mutationFn: (sport: KeySport | null) => saveKeySessionSport({ data: { id, sport } }),
    onMutate: (sport) => {
      queryClient.setQueryData(weekTargetQueryOptions.queryKey, (current) =>
        current?.plan
          ? {
              ...current,
              plan: {
                ...current.plan,
                keySessionSports: withKeySessionSport(current.plan.keySessionSports, { id, sport }),
              },
            }
          : current,
      );
    },
    onError: () => {
      toast.add({
        type: "error",
        title: "Could not save the sport",
        description: "Check your connection and pick it again.",
      });
      void queryClient.invalidateQueries({ queryKey: weekTargetQueryOptions.queryKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryOptions.queryKey });
    },
  });
  const sport = status.session.sport === "running" ? "running" : "cycling";

  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      spacing={0}
      aria-label={`Sport for ${keySessionName(status.session)}`}
      value={[sport]}
      onValueChange={(next) => {
        const picked = KEY_SPORTS.find((option) => option.id === next[0])?.id;
        if (!picked || picked === sport) return;
        save.mutate(picked === status.suggestedSport ? null : picked);
      }}
    >
      {KEY_SPORTS.map((option) => (
        <ToggleGroupItem key={option.id} value={option.id}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function keySportHint(status: KeySessionStatus) {
  const suggested = status.suggestedSport === "running" ? "run" : "ride";
  return status.sportPinned ? `Your pick · VO2 suggests a ${suggested}` : "VO2’s pick";
}

function WeekMixCard({ summary }: { summary: WeekSummary }) {
  const { keySessions, easy, paused } = summary;
  const doneCount = keySessions.filter((status) => status.done).length;
  const keyCount = keySessions.filter((status) => !status.skipped).length;
  const easyCount = easy.min === easy.max ? `${easy.max}` : `${easy.min}–${easy.max}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Week mix
          {keySessions.length ? (
            <Badge variant={doneCount === keySessions.length ? "success" : "outline"}>
              {doneCount} of {keySessions.length} key sessions
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {keyCount
            ? `This week: ${keyCount} key ${keyCount === 1 ? "session" : "sessions"} and ${easyCount} easy ones. A key session counts once any ride or run spends enough time in its zone. Pick the sport you plan it on.`
            : `This week: ${easyCount} easy sessions.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {paused ? (
          <Alert variant="warning">
            <PauseIcon />
            <AlertTitle>Key sessions paused</AlertTitle>
            <AlertDescription>
              Form is {signed(summary.form)}, very fatigued. Bank easy time; key sessions come back
              once form recovers.
            </AlertDescription>
          </Alert>
        ) : null}
        {keySessions.length ? (
          <ItemGroup className="gap-2">
            {keySessions.map((status) => {
              const done = status.done;
              return (
                <Item
                  key={status.session.id}
                  variant={done ? "muted" : "outline"}
                  size="sm"
                  className={cn((paused || status.skipped) && !done && "opacity-50")}
                >
                  <ItemMedia variant="icon">
                    {done ? (
                      <CircleCheckIcon className="text-success" />
                    ) : (
                      <CircleIcon className="text-muted-foreground" />
                    )}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <Link
                        to="/week/session"
                        search={{ key: status.session.id }}
                        className="hover:underline"
                      >
                        {keySessionName(status.session)}
                      </Link>
                    </ItemTitle>
                    <ItemDescription>
                      {done ? (
                        <Link
                          to="/activities/$activityId"
                          params={{ activityId: done.id }}
                          className="hover:underline"
                        >
                          {done.title} · {format(parseISO(`${done.date}T12:00:00`), "EEE d")}
                        </Link>
                      ) : status.skipped ? (
                        "Dropped: not enough days left. Its time moved to easy."
                      ) : (
                        keySportHint(status)
                      )}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <span className="font-mono text-xs tabular-nums">
                      {minutesLabel(status.minutes)}
                    </span>
                  </ItemActions>
                  {!done && !status.skipped ? (
                    <div className="basis-full">
                      <KeySportPicker status={status} />
                    </div>
                  ) : null}
                </Item>
              );
            })}
          </ItemGroup>
        ) : (
          <p className="text-muted-foreground text-sm">
            Your week mix is all easy.{" "}
            <Link
              to="/settings/$section"
              params={{ section: "training" }}
              className="text-foreground underline underline-offset-4"
            >
              Change the key / easy split
            </Link>{" "}
            to get intervals or time in zone.
          </p>
        )}
        <div className="flex flex-col gap-1 border-t pt-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <MoonIcon className="text-ds-teal-700 size-4" />
              Easy sessions · Z1–2
            </span>
            <span className="font-mono text-xs tabular-nums">
              {easy.done} of {easy.planned} done
              {easy.min !== easy.max ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {easy.min}–{easy.max} this week
                </span>
              ) : null}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {easy.left > 0
              ? `${minutesLabel(easy.left)} of easy time left${easy.planned > easy.done ? `, about ${minutesLabel(easy.perSession)} a session` : ""}.`
              : "Easy time is done for the week."}
          </p>
          {summary.doubles.allowed > 0 || summary.doubles.used > 0 ? (
            <p className="text-muted-foreground text-xs">
              Double days: {summary.doubles.used} of {summary.doubles.allowed} used.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SplitCard({ summary }: { summary: WeekSummary }) {
  const families = (["cycling", "running", "other"] as const).filter(
    (family) => summary.bySport[family].done + summary.bySport[family].left > 0,
  );
  const sportMax = Math.max(
    1,
    ...families.map((family) => summary.bySport[family].done + summary.bySport[family].left),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>What’s left by sport</CardTitle>
        <CardDescription>Split from your last {HISTORY_WEEKS} weeks.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {families.length ? (
          families.map((family) => {
            const style = FAMILY_STYLE[family];
            return (
              <SplitBar
                key={family}
                label={style.label}
                icon={style.icon}
                iconClass={style.text}
                barClass={style.bar}
                done={summary.bySport[family].done}
                left={summary.bySport[family].left}
                max={sportMax}
              />
            );
          })
        ) : (
          <p className="text-muted-foreground text-sm">Nothing left this week.</p>
        )}
      </CardContent>
    </Card>
  );
}

const CHOICE_KEY = "vo2:today";

/** Today's choice survives closing and resuming the app, and resets the next day. */
function useTodayChoice(today: string, fallback: TodayChoice) {
  const [choice, setChoice] = useState<TodayChoice>(fallback);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHOICE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { day?: string; choice?: TodayChoice };
      if (saved.day === today && saved.choice) setChoice({ ...fallback, ...saved.choice });
    } catch {
      // A broken or blocked storage entry just means starting from VO2's defaults.
    }
    // The fallback only matters on first load of the day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);
  const update = (next: Partial<TodayChoice>) => {
    setChoice((current) => {
      const merged = { ...current, ...next };
      try {
        window.localStorage.setItem(CHOICE_KEY, JSON.stringify({ day: today, choice: merged }));
      } catch {
        // Not persisting is fine; the choice still applies until the page closes.
      }
      return merged;
    });
  };
  return [choice, update] as const;
}

function ChoiceToggle<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <ToggleGroup
        size="sm"
        variant="outline"
        spacing={0}
        aria-label={label}
        value={[String(value)]}
        onValueChange={(next) => {
          const found = options.find((option) => String(option.id) === next[0]);
          if (found) onChange(found.id);
        }}
        className="flex-wrap"
      >
        {options.map((option) => (
          <ToggleGroupItem key={String(option.id)} value={String(option.id)}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const WINDOW_OPTIONS = AVAILABLE_WINDOWS.map((window) => ({
  id: window.minutes as number,
  label: window.label as string,
}));

/** Today's sports in order: "Ride", or "Swim, then ride", up to three parts. */
function DaySportsField({
  sports,
  onChange,
}: {
  sports: DaySport[];
  onChange: (sports: DaySport[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {sports.map((sport, index) => (
        <div
          // Parts are positional: the order is the meaning.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className="flex items-end gap-2"
        >
          <ChoiceToggle
            label={index === 0 ? "Sport" : "Then"}
            value={sport}
            options={DAY_SPORTS}
            onChange={(next) => onChange(sports.map((item, at) => (at === index ? next : item)))}
          />
          {index > 0 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove part ${index + 1}`}
              onClick={() => onChange(sports.filter((_, at) => at !== index))}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      {sports.length < MAX_DAY_PARTS ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...sports, sports.at(-1) === "cycling" ? "running" : "cycling"])}
        >
          <PlusIcon data-icon="inline-start" />
          Add a sport after
        </Button>
      ) : null}
    </div>
  );
}

/** How today's time is shared between sports: VO2's split, or the athlete's own. */
function SplitField({
  available,
  sports,
  parts,
  custom,
  onChange,
}: {
  available: number;
  sports: DaySport[];
  parts: DayPart[];
  custom: boolean;
  onChange: (split: number[] | null) => void;
}) {
  // A part VO2 dropped as too short still gets a share once the athlete moves the handles.
  const minutes =
    parts.length === sports.length
      ? parts.map((part) => part.minutes)
      : sports.map(() => Math.round(available / sports.length / 5) * 5);
  const labels = sports.map((sport, index) =>
    parts.length === sports.length
      ? SPORT_STYLE[parts[index].sport].label
      : (DAY_SPORTS.find((item) => item.id === sport)?.label ?? sport),
  );
  const boundaries = minutes
    .slice(0, -1)
    .map((_, index) => minutes.slice(0, index + 1).reduce((sum, value) => sum + value, 0));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Split · {custom ? "yours" : "VO2’s"}</span>
        {custom ? (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onChange(null)}>
            Auto split
          </Button>
        ) : null}
      </div>
      <Slider
        aria-label="Time per sport"
        min={0}
        max={available}
        step={5}
        minStepsBetweenValues={SPLIT_MIN_MINUTES / 5}
        value={boundaries}
        onValueChange={(next) => {
          const marks = (Array.isArray(next) ? next : [next]).map((mark) =>
            clamp5(mark, SPLIT_MIN_MINUTES, available - SPLIT_MIN_MINUTES),
          );
          const edges = [0, ...marks, available];
          onChange(edges.slice(1).map((edge, index) => edge - edges[index]));
        }}
      />
      <div className="flex flex-wrap justify-between gap-x-3 text-xs">
        {labels.map((label, index) => (
          // Positional: the order is the meaning.
          // oxlint-disable-next-line react/no-array-index-key
          <span key={index} className="font-mono tabular-nums">
            {label} {minutesLabel(minutes[index])}
          </span>
        ))}
      </div>
    </div>
  );
}

function clamp5(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, Math.round(value / 5) * 5));
}

function TodayDoneList({ activities }: { activities: WeekActivity[] }) {
  return (
    <ItemGroup className="gap-2">
      {activities.map((activity) => {
        const style = FAMILY_STYLE[activity.family];
        return (
          <Item
            key={activity.id}
            variant="muted"
            size="sm"
            render={<Link to="/activities/$activityId" params={{ activityId: activity.id }} />}
          >
            <ItemMedia variant="icon">
              <CircleCheckIcon className="text-success" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{activity.title}</ItemTitle>
              <ItemDescription>
                {style.label} · {minutesLabel(activity.minutes)}
              </ItemDescription>
            </ItemContent>
          </Item>
        );
      })}
    </ItemGroup>
  );
}

function TodayCard({ data, summary }: { data: PlannedWeek; summary: WeekSummary }) {
  const [choice, setChoice] = useTodayChoice(data.today, {
    available: defaultWindow(summary),
    sports: ["any"],
    feel: "auto",
  });
  const pick = useMemo(() => recommendToday(data, summary, choice), [data, summary, choice]);
  const vo2Pick = useMemo(
    () => recommendToday(data, summary, { ...choice, sports: ["any"], feel: "auto" }),
    [data, summary, choice],
  );
  const steps = useMemo(() => sessionSteps(pick, data), [pick, data]);
  const doneToday = todayActivities(data);
  const complete = isTodayComplete(data);
  const overridden = !isDefaultChoice(choice) && vo2Pick.title !== pick.title;
  const style = FAMILY_STYLE[pick.family];
  const Icon = pick.kind === "rest" ? MoonIcon : style.icon;

  const planner = (
    <>
      <ChoiceToggle
        label="Time"
        value={choice.available}
        options={WINDOW_OPTIONS}
        onChange={(available) => setChoice({ available, split: null })}
      />
      <DaySportsField
        sports={choice.sports}
        onChange={(sports) => setChoice({ sports, split: null })}
      />
      {choice.sports.length > 1 && pick.kind !== "rest" ? (
        <SplitField
          available={choice.available}
          sports={choice.sports}
          parts={pick.parts}
          custom={customSplit(choice) != null}
          onChange={(split) => setChoice({ split })}
        />
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <ChoiceToggle
          label="Feel"
          value={choice.feel}
          options={TODAY_FEELS}
          onChange={(feel) => setChoice({ feel })}
        />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex items-start gap-3">
          <Icon className={cn("mt-0.5 size-5 shrink-0", pick.kind !== "rest" && style.text)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{pick.title}</span>
              {pick.minutes > 0 ? (
                <span className="font-mono text-sm tabular-nums">
                  {minutesLabel(pick.parts.reduce((sum, part) => sum + part.minutes, 0))}
                </span>
              ) : null}
            </div>
            <p className="text-sm">{pick.description}</p>
            {pick.reasons.length ? (
              <ul className="text-muted-foreground flex list-disc flex-col gap-0.5 ps-4 text-xs">
                {pick.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {pick.warnings.length ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Your call</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-0.5 ps-4">
                {pick.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {pick.minutes > 0 ? <SessionStrip steps={steps} /> : null}
        {pick.minutes > 0 ? (
          <div className="grid grid-cols-3 gap-3 border-t pt-3">
            <Stat label="Left after" value={minutesLabel(pick.after.remainingMinutes)} />
            <Stat
              label="Form tomorrow"
              value={signed(pick.after.formTomorrow)}
              hint={pick.after.formTomorrowLabel}
            />
            <Stat
              label="Fitness"
              value={`+${pick.after.fitnessChange.toFixed(1)}`}
              hint={`Load ~${pick.load}`}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {pick.minutes > 0 ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/week/session"
                  search={{
                    available: choice.available,
                    feel: choice.feel,
                    sports: choice.sports.join(","),
                    ...(customSplit(choice) ? { split: choice.split?.join(",") } : {}),
                  }}
                />
              }
              nativeButton={false}
            >
              View session
            </Button>
          ) : null}
          {overridden ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChoice({ sports: ["any"], feel: "auto" })}
            >
              VO2 would pick {vo2Pick.title} · use it
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Whatever you end up doing counts once it syncs: the week re-plans from your activities,
        suggested or not.
      </p>
    </>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Today
          {complete ? <Badge variant="success">Done</Badge> : null}
        </CardTitle>
        <CardDescription>
          {complete
            ? "Today is done. Another session today is extra."
            : "Tell VO2 what you feel like. It shapes the session around it and shows what it costs."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {complete ? (
          <>
            <TodayDoneList activities={doneToday} />
            <Collapsible className="group/today-more flex flex-col gap-4">
              <CollapsibleTrigger
                render={<Button variant="outline" size="sm" className="self-start" />}
              >
                Another session
                <ChevronDownIcon
                  data-icon="inline-end"
                  className="transition-transform group-data-panel-open/today-more:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-4">{planner}</CollapsibleContent>
            </Collapsible>
          </>
        ) : (
          planner
        )}
      </CardContent>
    </Card>
  );
}

function ProjectionCard({ data, summary }: { data: PlannedWeek; summary: WeekSummary }) {
  const projection = useMemo(() => projectWeek(data, summary), [data, summary]);
  const rampPct =
    projection.rampRatio == null ? null : Math.round((projection.rampRatio - 1) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>If you finish the week</CardTitle>
        <CardDescription>
          The remaining load spread over the days you have left, through the fitness model.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Fitness Sunday"
            value={Math.round(projection.fitnessSunday)}
            hint={`${signed(projection.fitnessSunday - projection.fitnessNow)} from now`}
          />
          <Stat
            label="Form Monday"
            value={signed(projection.formMonday)}
            hint={projection.formMondayLabel}
          />
          <Stat
            label="Week load"
            value={projection.weekLoad}
            hint={
              rampPct == null
                ? "No recent weeks to compare"
                : `${rampPct >= 0 ? "+" : "−"}${Math.abs(rampPct)}% vs last 4 weeks`
            }
          />
        </div>
        {projection.warn ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Big jump in load</AlertTitle>
            <AlertDescription>
              This week would be {rampPct}% above your last 4-week average of{" "}
              {projection.recentAverageLoad}. Jumps over 30% raise injury risk. Consider a slower
              build pace or fixed hours.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DoneCard({ data }: { data: PlannedWeek }) {
  if (!data.activities.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Counted this week</CardTitle>
        <CardDescription>Every copied activity counts toward the target.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          {data.activities.map((activity) => {
            const style = FAMILY_STYLE[activity.family];
            return (
              <Item
                key={activity.id}
                variant="muted"
                size="sm"
                render={<Link to="/activities/$activityId" params={{ activityId: activity.id }} />}
              >
                <ItemMedia variant="icon">
                  <style.icon className={style.text} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{activity.title}</ItemTitle>
                  <ItemDescription>
                    {format(parseISO(`${activity.date}T12:00:00`), "EEE d")}
                    {activity.hardMinutes > 0
                      ? ` · ${minutesLabel(activity.hardMinutes)} hard${activity.hardSource === "estimate" ? " (estimated)" : ""}`
                      : ""}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="font-mono text-xs tabular-nums">
                    {minutesLabel(activity.minutes)}
                  </span>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

export function WeekTargetView({ data }: { data: PlannedWeek }) {
  const summary = useMemo(() => summarizeWeek(data), [data]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:gap-6 md:grid-cols-2">
      <TargetCard data={data} summary={summary} />
      <TodayCard data={data} summary={summary} />
      <WeekMixCard summary={summary} />
      <SplitCard summary={summary} />
      <ProjectionCard data={data} summary={summary} />
      <DoneCard data={data} />
    </div>
  );
}
