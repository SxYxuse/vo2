"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ChevronLeftIcon, FlagIcon, MoonIcon, XIcon } from "lucide-react";
import { cn } from "cn";

import { afterGoalsChanged } from "@/lib/query-events.ts";
import { planBuilderQueryOptions } from "@/lib/queries.ts";
import { previewPlan } from "@/services/plan-builder.ts";
import {
  goalEffect,
  type BuilderData,
  type HistoryStats,
  type PlanDraft,
} from "@/services/plan-builder.types.ts";
import { updateGoal } from "@/services/season.ts";
import {
  GOAL_OBJECTIVES,
  GOAL_PRIORITIES,
  anchorEvent,
  daysBetween,
  eventTitle,
  formatDaysLeft,
  seasonEvents,
  type Goal,
} from "@/services/season.types.ts";
import {
  KEY_SPORTS,
  NO_HISTORY_MINUTES_PER_DAY,
  formatHours,
  trainingDayCount,
  type WeekShape,
} from "@/services/training-plan.types.ts";
import { PriorityBadge, SeasonMap } from "@/components/season-map.tsx";
import {
  dayOfMonth,
  minutesLabel,
  sessionTitle,
  signed,
  weekdayShort,
} from "@/components/planned-session.ts";
import { SETUP_CARD, SETUP_FOOTER, SetupProgress } from "@/components/onboarding-shell.tsx";
import { ListSkeleton, PanelSkeleton } from "@/components/route-states.tsx";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { StatCard, StatGrid } from "@/components/stat-card.tsx";
import { WeekShapeFields } from "@/components/week-shape-fields.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const STEPS = [
  { id: "season", title: "Your season" },
  { id: "start", title: "Where you're starting" },
  { id: "week", title: "When can you train?" },
  { id: "preview", title: "Your plan" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

/** A draft starts from the saved plan when rebuilding, else from the athlete's history. */
function initialDraft(data: BuilderData): PlanDraft {
  const shape = data.current ?? data.suggested;
  return {
    restWeekdays: shape.restWeekdays,
    longWeekday: shape.longWeekday,
    doubleDays: shape.doubleDays,
    sports: shape.sports,
    baselineMinutes: data.current?.baselineMinutes ?? null,
    timeZone: data.timeZone,
  };
}

/**
 * The plan builder (ADR 0026): the season, where the athlete is now, when they can train, and a
 * preview. Every answer starts from the goals on Season and the last 12 weeks.
 */
export function PlanBuilder({
  onStart,
  starting,
  error,
  onExit,
  exitLabel = "Close",
  onboarding = false,
}: {
  onStart: (draft: PlanDraft) => void;
  starting: boolean;
  error: string | null;
  /** Leaving from the first step: back to onboarding's previous step, or out of the builder. */
  onExit?: () => void;
  exitLabel?: string;
  /** During onboarding Season is not open yet, so the builder does not link to it. */
  onboarding?: boolean;
}) {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const { data, error: loadError } = useQuery(planBuilderQueryOptions(timeZone));
  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load your plan</AlertTitle>
        <AlertDescription>{loadError.message}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <PanelSkeleton bodyClassName="h-56" />;
  return (
    <BuilderSteps
      data={data}
      onStart={onStart}
      starting={starting}
      error={error}
      onExit={onExit}
      exitLabel={exitLabel}
      onboarding={onboarding}
    />
  );
}

function BuilderSteps({
  data,
  onStart,
  starting,
  error,
  onExit,
  exitLabel,
  onboarding,
}: {
  data: BuilderData;
  onStart: (draft: PlanDraft) => void;
  starting: boolean;
  error: string | null;
  onExit?: () => void;
  exitLabel: string;
  onboarding: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(() => initialDraft(data));
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  return (
    <Card className={SETUP_CARD}>
      <CardHeader className="gap-2 border-b">
        {onboarding ? (
          <div className="col-span-full">
            <SetupProgress step={3} substep={{ index, count: STEPS.length }} />
          </div>
        ) : (
          <CardDescription>
            Build your plan · {index + 1} of {STEPS.length}
          </CardDescription>
        )}
        <CardTitle>
          <h1 className="text-xl font-semibold tracking-tight">{titleFor(step.id, data)}</h1>
        </CardTitle>
        {onExit && exitLabel !== "Back" ? (
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label={exitLabel} onClick={onExit}>
              <XIcon />
            </Button>
          </CardAction>
        ) : null}
        {onboarding ? null : (
          <div className="col-span-full flex gap-1" aria-hidden>
            {STEPS.map((item, at) => (
              <span
                key={item.id}
                className={cn("h-1 flex-1 rounded-full", at <= index ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent
        key={step.id}
        className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200"
      >
        {step.id === "season" ? (
          <SeasonStep data={data} onboarding={onboarding} />
        ) : step.id === "start" ? (
          <StartStep data={data} draft={draft} onChange={setDraft} />
        ) : step.id === "week" ? (
          <WeekShapeFields
            value={draft}
            onChange={(shape: WeekShape) => setDraft((current) => ({ ...current, ...shape }))}
            hints={
              data.stats.weeks >= 3
                ? {
                    weekdayShare: data.stats.weekdayShare,
                    usualLongWeekday: data.stats.usualLongWeekday,
                    doubleDaysPerWeek: data.stats.doubleDaysPerWeek,
                  }
                : {}
            }
          />
        ) : (
          <PreviewStep data={data} draft={draft} />
        )}
        {error && last ? (
          <Alert variant="destructive">
            <AlertTitle>Could not start your plan</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className={SETUP_FOOTER}>
        {index > 0 ? (
          <Button
            variant="outline"
            className="max-sm:flex-1"
            onClick={() => setIndex(index - 1)}
            disabled={starting}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            Back
          </Button>
        ) : onExit && exitLabel === "Back" ? (
          <Button variant="outline" className="max-sm:flex-1" onClick={onExit}>
            <ChevronLeftIcon data-icon="inline-start" />
            Back
          </Button>
        ) : null}
        <Button
          className="ms-auto max-sm:flex-1"
          disabled={starting}
          onClick={() => (last ? onStart(draft) : setIndex(index + 1))}
        >
          {starting ? <Spinner data-icon="inline-start" /> : null}
          {last ? "Start my plan" : step.id === "start" ? "Looks right" : "Continue"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function titleFor(step: StepId, data: BuilderData) {
  if (step !== "preview") return STEPS.find((item) => item.id === step)!.title;
  const lead = anchorEvent(seasonEvents(data.goals));
  if (!lead) return "Your plan: hold your fitness";
  const weeks = Math.max(1, Math.ceil(daysBetween(data.today, lead.date) / 7));
  return `${weeks} ${weeks === 1 ? "week" : "weeks"} to ${eventTitle(lead)}`;
}

function SeasonStep({ data, onboarding }: { data: BuilderData; onboarding: boolean }) {
  const events = seasonEvents(data.goals);
  const lead = anchorEvent(events);
  if (!events.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlagIcon />
          </EmptyMedia>
          <EmptyTitle>No goal on Season yet</EmptyTitle>
          <EmptyDescription>
            Without one, VO2 plans your weeks to hold your fitness. Add a race or event on Season
            {onboarding ? " once you're set up" : ""} and VO2 will offer to adapt the plan to it.
          </EmptyDescription>
        </EmptyHeader>
        {onboarding ? null : (
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link to="/season" />}>
              <FlagIcon data-icon="inline-start" />
              Add a goal on Season
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }
  return (
    <>
      <p className="text-muted-foreground text-sm">
        The plan uses every goal below. Check the priority and what you want from each.
      </p>
      <ul className="flex flex-col gap-3">
        {events.map((event) => (
          <li key={event.date}>
            <GoalRow
              goal={event.goals[0]!}
              title={eventTitle(event)}
              legs={event.goals.length}
              leads={event === lead}
              today={data.today}
            />
          </li>
        ))}
      </ul>
      {onboarding ? null : (
        <Button
          variant="link"
          className="self-start px-0"
          nativeButton={false}
          render={<Link to="/season" />}
        >
          Add or edit goals on Season
        </Button>
      )}
    </>
  );
}

function GoalRow({
  goal,
  title,
  legs,
  leads,
  today,
}: {
  goal: Goal;
  title: string;
  legs: number;
  leads: boolean;
  today: string;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: Partial<Pick<Goal, "priority" | "objective">>) => {
      const { id, ...input } = { ...goal, ...patch };
      return updateGoal({ data: { ...input, id } });
    },
    onSuccess: () => afterGoalsChanged(queryClient),
  });
  const facts = [
    format(parseISO(`${goal.date}T12:00:00`), "EEE d MMM"),
    legs > 1 ? `${legs} sports` : goal.sportType,
    goal.distanceM ? `${Math.round(goal.distanceM / 100) / 10} km` : null,
    goal.elevationGainM ? `${Math.round(goal.elevationGainM)} m` : null,
    formatDaysLeft(daysBetween(today, goal.date)).toLowerCase(),
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border p-3",
        leads && "border-primary ring-primary/20 ring-2",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityBadge priority={goal.priority} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-1.5 font-medium">
            {title}
            {leads ? <Badge>Leads</Badge> : null}
          </span>
          <span className="text-muted-foreground text-xs">{facts.join(" · ")}</span>
        </div>
        {save.isPending ? <Spinner /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[goal.priority]}
          aria-label="Priority"
          onValueChange={(next) => {
            const priority = (next as Goal["priority"][])[0];
            if (priority && priority !== goal.priority) save.mutate({ priority });
          }}
        >
          {GOAL_PRIORITIES.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id} aria-label={item.label}>
              {item.id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[goal.objective]}
          aria-label="Objective"
          onValueChange={(next) => {
            const objective = (next as Goal["objective"][])[0];
            if (objective && objective !== goal.objective) save.mutate({ objective });
          }}
        >
          {GOAL_OBJECTIVES.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <p className="bg-muted/60 text-muted-foreground rounded-md px-2.5 py-1.5 text-xs">
        {goalEffect(goal, leads)}
      </p>
      {save.error ? <p className="text-destructive text-xs">{save.error.message}</p> : null}
    </div>
  );
}

function SportSplit({ stats }: { stats: HistoryStats }) {
  const shown = KEY_SPORTS.filter((sport) => stats.sportShare[sport] >= 0.01);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">Sport split</span>
      <div className="flex h-2 overflow-hidden rounded-full">
        {shown.map((sport) => (
          <span
            key={sport}
            className={SPORT_STYLE[sport].bar}
            style={{ width: `${stats.sportShare[sport] * 100}%` }}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-xs">
        {shown
          .map(
            (sport) => `${SPORT_STYLE[sport].label} ${Math.round(stats.sportShare[sport] * 100)} %`,
          )
          .join(" · ")}
      </span>
    </div>
  );
}

function StartStep({
  data,
  draft,
  onChange,
}: {
  data: BuilderData;
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
}) {
  const { stats } = data;
  const hasHistory = stats.weeks >= 3;
  const fallback = hasHistory
    ? Math.max(60, Math.round((stats.weeklyMinutes.average * 0.6) / 15) * 15)
    : trainingDayCount(draft) * NO_HISTORY_MINUTES_PER_DAY;
  const custom = draft.baselineMinutes != null;
  return (
    <>
      <p className="text-muted-foreground text-sm">
        {hasHistory
          ? "Read from your last 12 weeks on Strava. The plan builds from here and never adds more than 10 % a week."
          : "Not enough history yet: VO2 starts at 45 minutes per training day and learns from what you do."}
      </p>
      {hasHistory ? (
        <StatGrid footer={<SportSplit stats={stats} />}>
          <StatCard
            label="Weekly time"
            value={minutesLabel(stats.weeklyMinutes.average)}
            hint={`usually ${minutesLabel(stats.weeklyMinutes.low)} – ${minutesLabel(stats.weeklyMinutes.high)}`}
          />
          <StatCard
            label="Sessions"
            value={`${Math.round(stats.sessionsPerWeek * 10) / 10} / week`}
            hint={
              stats.doubleDaysPerWeek >= 0.5
                ? `2 sessions on ${Math.round(stats.doubleDaysPerWeek)} day a week`
                : undefined
            }
          />
          <StatCard
            label="Fitness"
            value={Math.round(data.fitness.ctl)}
            hint={`Form ${signed(data.fitness.form)}`}
          />
          {stats.longest ? (
            <StatCard
              label="Longest session"
              value={minutesLabel(stats.longest.minutes)}
              hint={format(parseISO(`${stats.longest.date}T12:00:00`), "EEE d MMM")}
            />
          ) : null}
        </StatGrid>
      ) : null}
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="plan-baseline" className="flex flex-col items-start gap-0.5">
            <span className="font-medium">
              {hasHistory ? "I've had a break or an injury" : "Set where I start"}
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              {hasHistory
                ? "Start lower than your history says."
                : "Hours you can train a week to begin with."}
            </span>
          </Label>
          <Switch
            id="plan-baseline"
            checked={custom}
            onCheckedChange={(checked) =>
              onChange({ ...draft, baselineMinutes: checked ? fallback : null })
            }
          />
        </div>
        {custom ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm">
              Start from {formatHours(draft.baselineMinutes! / 60)} a week
            </span>
            <Slider
              min={60}
              max={Math.max(900, stats.weeklyMinutes.high)}
              step={15}
              value={[draft.baselineMinutes!]}
              onValueChange={(next) => {
                const value = Array.isArray(next) ? next[0] : next;
                if (typeof value === "number") onChange({ ...draft, baselineMinutes: value });
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function PreviewStep({ data, draft }: { data: BuilderData; draft: PlanDraft }) {
  const {
    data: preview,
    error,
    isPending,
  } = useQuery({
    queryKey: ["plan-preview", draft],
    queryFn: () => previewPlan({ data: draft }),
    staleTime: 60_000,
  });
  const events = seasonEvents(data.goals);
  const lead = anchorEvent(events);
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not preview the plan</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  if (isPending || !preview) {
    // Shaped like the preview below (season bars, then a short day list) so nothing jumps.
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-3 w-40" />
        <ListSkeleton rows={2} />
      </div>
    );
  }
  const thisWeek = preview.days.filter((day) => !day.beforePlan);
  const weekMinutes = thisWeek.reduce(
    (sum, day) => sum + day.sessions.reduce((total, item) => total + item.minutes, 0),
    0,
  );
  const peak = Math.max(0, ...preview.weeks.map((week) => week.hours));
  return (
    <>
      {preview.weeks.length ? (
        <div className="flex flex-col gap-1.5">
          <SeasonMap weeks={preview.weeks} events={events} compact />
          <div className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs">
            <span>{formatHours(preview.weeks[0]!.hours)} this week</span>
            <span>peak ≈ {formatHours(peak)}</span>
            {preview.raceDayForm != null ? (
              <span>race-day form {signed(preview.raceDayForm)}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {events.length > 1 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-xs">
          <span className="text-muted-foreground font-medium">How each goal shapes it</span>
          {events.map((event) => (
            <span key={event.date}>
              <span className="font-medium">
                {eventTitle(event)} ({event.goals[0]!.priority})
              </span>
              : {goalEffect(event.goals[0]!, event === lead)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground flex justify-between text-xs font-medium">
          <span>This week, from today</span>
          <span>{minutesLabel(weekMinutes)}</span>
        </span>
        <ul className="flex flex-col overflow-hidden rounded-lg border">
          {thisWeek.map((day) => (
            <li
              key={day.date}
              className={cn(
                "flex items-center gap-3 border-t px-3 py-2 text-sm first:border-t-0",
                day.rest && "bg-muted/40 text-muted-foreground",
              )}
            >
              <span className="text-muted-foreground w-12 shrink-0 text-xs uppercase">
                {weekdayShort(day.date)} {dayOfMonth(day.date)}
              </span>
              {day.rest && !day.sessions.length ? (
                <span className="flex items-center gap-1.5">
                  <MoonIcon aria-hidden className="size-3.5" />
                  Rest
                </span>
              ) : (
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {day.sessions.length ? (
                    day.sessions.map((item) => (
                      <span key={item.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {sessionTitle(item, day)}
                          {item.kind === "key" ? (
                            <Badge variant="info" className="ms-1.5">
                              Key
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {minutesLabel(item.minutes)}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">Free</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
