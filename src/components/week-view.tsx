"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import {
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  FlagIcon,
  HouseIcon,
  InfoIcon,
  LeafIcon,
  MoonIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";

import { weekCoachQueryOptions } from "@/lib/queries.ts";
import { LIGHTER_HINT, PHASES } from "@/services/season-phase.ts";
import { daysBetween, formatDaysLeft, seasonEvents, eventTitle } from "@/services/season.types.ts";
import { formatHours, keySessionName, type TrainingPlan } from "@/services/training-plan.types.ts";
import { addCoachNote, removeCoachNote, replanWeek } from "@/services/week-coach.ts";
import {
  CONSTRAINT_KINDS,
  constraintsOn,
  matchWeek,
  projectPlan,
  weekMinutes,
  type ConstraintKind,
  type DayView,
  type SessionView,
  type WeekCoachState,
} from "@/services/week-plan.ts";
import { summarizeWeek, type WeekSummary, type WeekTargetData } from "@/services/week-target.ts";
import { AdaptPlanDialog, changedGoalsLabel } from "@/components/plan-adapt.tsx";
import {
  dayLabel,
  dayOfMonth,
  minutesLabel,
  sessionTitle,
  signed,
  weekRangeLabel,
  weekdayShort,
} from "@/components/planned-session.ts";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { PhaseBadge, PriorityBadge } from "@/components/season-map.tsx";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type PlannedWeek = WeekTargetData & { plan: TrainingPlan };

const CONSTRAINT_ICON: Record<ConstraintKind, typeof BanIcon> = {
  off: BanIcon,
  short: ClockIcon,
  indoor: HouseIcon,
  easy: LeafIcon,
};

const SHORT_WINDOWS = [30, 45, 60, 90] as const;

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * Plans the rest of the week again when the stored plan predates a sync, a note, or a settings
 * change. The server answers from storage when nothing changed, so this is cheap.
 */
function useReplanWhenStale(coach: WeekCoachState | undefined) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const asked = useRef<string | null>(null);
  const replan = useMutation({
    mutationFn: () => replanWeek(),
    onSuccess: (state) => queryClient.setQueryData(weekCoachQueryOptions.queryKey, state),
  });
  const stale = coach?.stale ?? false;
  const key = coach
    ? `${coach.weekStart}:${coach.notes.length}:${coach.plan?.createdAt ?? ""}`
    : "";
  useEffect(() => {
    if (!stale || !online || asked.current === key) return;
    asked.current = key;
    replan.mutate();
    // The mutation object changes every render; the key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, online, key]);
  return replan.isPending;
}

/** Why the week looks the way it does: only what the planner used. */
function weekReasons(data: PlannedWeek, summary: WeekSummary, coach: WeekCoachState) {
  const reasons: string[] = [];
  const phase = data.season;
  if (phase.lighter) reasons.push(LIGHTER_HINT);
  else if (phase.kind !== "hold") reasons.push(PHASES[phase.kind].hint);
  switch (summary.target.source) {
    case "ramp-cap":
      reasons.push("Held to 10 % above your last four weeks.");
      break;
    case "form":
      reasons.push("Eased off: form is low, so the week holds instead of building.");
      break;
    case "baseline":
      reasons.push("Growing from where you started after your break, 10 % a week at most.");
      break;
    case "no-history":
      reasons.push("45 minutes per training day until VO2 has enough of your history.");
      break;
    default:
      break;
  }
  if (summary.paused) reasons.push("Form is very low: key sessions wait until you freshen up.");
  if (summary.runCapped) reasons.push("Running held to your recent running plus 15 %.");
  const dropped = coach.plan?.dropped ?? [];
  if (dropped.length) {
    const names = dropped
      .map((id) => summary.keySessions.find((status) => status.session.id === id)?.session)
      .filter((session) => session != null)
      .map((session) => keySessionName(session));
    if (names.length) reasons.push(`No room this week for ${names.join(" and ")}.`);
  }
  return reasons;
}

export function WeekView({ data }: { data: PlannedWeek }) {
  const summary = useMemo(() => summarizeWeek(data), [data]);
  const { data: coach } = useQuery(weekCoachQueryOptions);
  const replanning = useReplanWhenStale(coach);
  const [picked, setPicked] = useState<string | null>(null);
  const [adapting, setAdapting] = useState(false);
  const views = useMemo(
    () => (coach?.plan ? matchWeek(coach.plan, data, summary) : null),
    [coach?.plan, data, summary],
  );
  const keyNames = useMemo(
    () =>
      new Map(
        summary.keySessions.map((status) => [status.session.id, keySessionName(status.session)]),
      ),
    [summary],
  );

  if (!coach || !views) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  const projection = projectPlan(views, data, summary);
  const minutes = weekMinutes(views);
  const reasons = weekReasons(data, summary, coach);
  const pickedView = views.find((view) => view.day.date === picked) ?? null;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <WeekHeading data={data} replanning={replanning} />
      <Banners coach={coach} data={data} onAdapt={() => setAdapting(true)} />
      <Card className="py-3">
        <CardContent className="flex flex-col gap-3 px-3 sm:px-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Fitness"
              value={Math.round(projection.fitnessNow)}
              hint={`${signed(projection.fitnessSunday - projection.fitnessNow)} by Sunday`}
            />
            <Stat
              label="Form"
              value={signed(summary.form)}
              hint={
                projection.formMondayLabel
                  ? `${signed(projection.formMonday)} on Monday`
                  : undefined
              }
              tone={
                summary.form < -30
                  ? "text-destructive"
                  : summary.form < -10
                    ? "text-warning"
                    : undefined
              }
            />
            <Stat
              label="Week"
              value={minutesLabel(minutes.done)}
              hint={`of ${minutesLabel(minutes.total)} planned`}
            />
          </div>
          <WeekBar
            done={minutes.done}
            missed={minutes.missed}
            total={minutes.total + minutes.missed}
          />
        </CardContent>
      </Card>

      <ol className="grid grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-7 md:gap-2 md:overflow-visible md:rounded-none md:border-0">
        {views.map((view) => (
          <DayCell
            key={view.day.date}
            view={view}
            today={data.today}
            keyNames={keyNames}
            notes={coach.notes.filter((note) => note.date === view.day.date).length}
            onOpen={() => setPicked(view.day.date)}
          />
        ))}
      </ol>

      {coach.plan?.note ? (
        <Alert>
          <SparklesIcon />
          <AlertTitle>From your coach</AlertTitle>
          <AlertDescription>{coach.plan.note}</AlertDescription>
        </Alert>
      ) : null}
      {reasons.length ? (
        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5">
              <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      <DaySheet
        view={pickedView}
        data={data}
        coach={coach}
        keyNames={keyNames}
        onClose={() => setPicked(null)}
      />
      <AdaptPlanDialog impact={coach.seasonChange} open={adapting} onOpenChange={setAdapting} />
    </div>
  );
}

function WeekHeading({ data, replanning }: { data: PlannedWeek; replanning: boolean }) {
  const phase = data.season;
  const lead = phase.anchor.length ? seasonEvents(phase.anchor)[0]! : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PhaseBadge kind={phase.kind} lighter={phase.lighter} />
      {lead ? (
        <Badge variant="outline" className="max-w-full">
          <PriorityBadge priority={lead.goals[0]!.priority} />
          <span className="truncate">
            {eventTitle(lead)} · {formatDaysLeft(daysBetween(data.today, lead.date)).toLowerCase()}
          </span>
        </Badge>
      ) : null}
      <span className="text-muted-foreground ms-auto flex items-center gap-1.5 text-xs">
        {replanning ? <Spinner className="size-3" /> : null}
        {weekRangeLabel(data.weekStart)}
      </span>
    </div>
  );
}

function Banners({
  coach,
  data,
  onAdapt,
}: {
  coach: WeekCoachState;
  data: PlannedWeek;
  onAdapt: () => void;
}) {
  if (coach.needsReview) {
    return (
      <Alert variant="info">
        <SparklesIcon />
        <AlertTitle>Build your plan</AlertTitle>
        <AlertDescription>
          Plan your weeks around your season, your rest days, and your long session day.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" nativeButton={false} render={<Link to="/plan" />}>
            Build
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  if (coach.seasonChange) {
    const count = [
      ...coach.seasonChange.added,
      ...coach.seasonChange.edited,
      ...coach.seasonChange.removed,
    ].length;
    return (
      <Alert variant="warning">
        <FlagIcon />
        <AlertTitle>
          {count === 1 ? "A goal change isn't in your plan" : "Goal changes aren't in your plan"}
        </AlertTitle>
        <AlertDescription>{changedGoalsLabel(coach.seasonChange)}</AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onAdapt}>
            Review
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  if (data.season.kind === "hold" && !data.season.anchor.length) {
    return (
      <Alert>
        <FlagIcon />
        <AlertTitle>No goal ahead</AlertTitle>
        <AlertDescription>
          Your plan holds your fitness on your usual days. Add a race or event to build toward it.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/season" />}>
            Add a goal
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  return null;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("font-mono text-lg font-semibold tabular-nums", tone)}>{value}</span>
      {hint ? <span className="text-muted-foreground truncate text-xs">{hint}</span> : null}
    </div>
  );
}

function WeekBar({ done, missed, total }: { done: number; missed: number; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="bg-muted flex h-2 overflow-hidden rounded-full" aria-hidden>
      <span className="bg-success" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
      <span className="bg-destructive/40" style={{ width: `${(missed / total) * 100}%` }} />
    </div>
  );
}

function DayCell({
  view,
  today,
  keyNames,
  notes,
  onOpen,
}: {
  view: DayView;
  today: string;
  keyNames: Map<string, string>;
  notes: number;
  onOpen: () => void;
}) {
  const { day } = view;
  const isToday = day.date === today;
  const empty = !view.sessions.length && !view.extras.length;
  return (
    <li
      className={cn(
        "border-t first:border-t-0 md:rounded-lg md:border md:first:border-t",
        isToday && "bg-info/5 md:border-info",
        day.rest && empty && "bg-muted/40",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-muted/40 flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left md:min-h-32 md:flex-col md:gap-2 md:px-2.5"
        aria-label={`${dayLabel(day.date, today)}: open the day`}
      >
        <span
          className={cn(
            "flex w-10 shrink-0 flex-col items-center md:w-auto md:flex-row md:gap-1.5",
            isToday ? "text-info" : "text-muted-foreground",
          )}
        >
          <span className="text-[11px] font-semibold uppercase">
            {isToday ? "Today" : weekdayShort(day.date)}
          </span>
          <span className="text-foreground text-lg font-semibold tabular-nums md:text-sm">
            {dayOfMonth(day.date)}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 self-stretch">
          {day.rest && empty ? (
            <span className="text-muted-foreground flex items-center gap-1.5 py-1 text-sm font-medium">
              <MoonIcon aria-hidden className="size-4" />
              Rest day
            </span>
          ) : day.beforePlan && empty ? (
            <span className="text-muted-foreground py-1 text-xs">Before this week's plan</span>
          ) : empty ? (
            <span className="text-muted-foreground py-1 text-xs">{day.note ?? "Free"}</span>
          ) : null}
          {view.sessions.map((item) => (
            <SessionChip key={item.session.id} item={item} view={view} keyNames={keyNames} />
          ))}
          {view.extras.map(({ activity, keySessionId }) => (
            <span
              key={activity.id}
              className="text-muted-foreground flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs"
            >
              <CheckIcon aria-hidden className="text-success size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {activity.title}
                {keySessionId && keyNames.get(keySessionId)
                  ? ` · ticked off ${keyNames.get(keySessionId)}`
                  : " · extra"}
              </span>
              <span className="tabular-nums">{minutesLabel(activity.minutes)}</span>
            </span>
          ))}
          {notes ? (
            <span className="text-muted-foreground text-[11px]">
              {notes === 1 ? "1 note" : `${notes} notes`} to the coach
            </span>
          ) : null}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="text-muted-foreground mt-2 size-4 shrink-0 md:hidden"
        />
      </button>
    </li>
  );
}

function SessionChip({
  item,
  view,
  keyNames,
}: {
  item: SessionView;
  view: DayView;
  keyNames: Map<string, string>;
}) {
  const { session, state, activity } = item;
  const style = session.sport === "other" ? SPORT_STYLE.other : SPORT_STYLE[session.sport];
  const Icon = session.kind === "race" ? FlagIcon : style.icon;
  const title = sessionTitle(session, view.day, keyNames);
  return (
    <span
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        state === "done" && "bg-success/10",
        state === "planned" && "bg-muted/60",
        (state === "missed" || state === "moved") && "border border-dashed opacity-70",
      )}
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-md text-white",
          state === "missed" || state === "moved" ? "bg-muted-foreground/50" : style.bar,
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-1 leading-tight font-medium",
            (state === "missed" || state === "moved") && "line-through",
          )}
        >
          <span className="min-w-0 truncate">{title}</span>
          {session.kind === "key" ? (
            <Badge variant="info" className="h-4 px-1 text-[10px]">
              Key
            </Badge>
          ) : null}
          {session.second ? (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              2nd
            </Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground truncate text-[11px]">
          {state === "done" && activity
            ? activity.date === view.day.date
              ? activity.title
              : `Done ${format(parseISO(`${activity.date}T12:00:00`), "EEE")} · ${activity.title}`
            : state === "missed"
              ? "Missed"
              : state === "moved"
                ? "Missed · planned again later"
                : (session.note ?? (view.day.indoor ? "Indoors" : ""))}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          state === "done" ? "text-success font-semibold" : "text-muted-foreground",
        )}
      >
        {state === "done" ? (
          <CheckIcon aria-label="Done" className="size-4" />
        ) : (
          minutesLabel(session.minutes)
        )}
      </span>
    </span>
  );
}

/** One day: its sessions, a link to each, and what the athlete can tell the coach about it. */
function DaySheet({
  view,
  data,
  coach,
  keyNames,
  onClose,
}: {
  view: DayView | null;
  data: PlannedWeek;
  coach: WeekCoachState;
  keyNames: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={view != null} onOpenChange={(open) => (open ? null : onClose())}>
      <ResponsiveDialogContent className="sm:max-w-md">
        {view ? (
          <DaySheetBody
            view={view}
            data={data}
            coach={coach}
            keyNames={keyNames}
            onDone={onClose}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function DaySheetBody({
  view,
  data,
  coach,
  keyNames,
  onDone,
}: {
  view: DayView;
  data: PlannedWeek;
  coach: WeekCoachState;
  keyNames: Map<string, string>;
  onDone: () => void;
}) {
  const { day } = view;
  const queryClient = useQueryClient();
  const online = useOnline();
  const [kind, setKind] = useState<ConstraintKind | null>(null);
  const [minutes, setMinutes] = useState<number>(45);
  const [text, setText] = useState("");
  const editable = day.date >= data.today;
  const settle = (state: WeekCoachState) =>
    queryClient.setQueryData(weekCoachQueryOptions.queryKey, state);
  const add = useMutation({
    mutationFn: () =>
      addCoachNote({
        data: {
          date: day.date,
          kind,
          minutes: kind === "short" ? minutes : null,
          text: text.trim(),
        },
      }),
    onSuccess: (state) => {
      settle(state);
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCoachNote({ data: { id } }),
    onSuccess: settle,
  });
  const notes = coach.notes.filter((note) => note.date === day.date);
  const limits = constraintsOn(
    notes.flatMap((note) => note.constraints),
    day.date,
  );
  const canSend = online && (kind != null || (coach.aiAvailable && text.trim().length > 0));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSend) add.mutate();
  }

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {format(parseISO(`${day.date}T12:00:00`), "EEEE d MMMM")}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {day.rest && !view.sessions.length
            ? limits.off
              ? "You can't train this day."
              : "A rest day: no session planned."
            : (day.note ??
              `${minutesLabel(view.sessions.reduce((sum, item) => sum + item.session.minutes, 0))} planned.`)}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="flex flex-col gap-4 px-4 pb-4 sm:px-0 sm:pb-0">
        {view.sessions.length ? (
          <ul className="flex flex-col gap-2">
            {view.sessions.map((item) => (
              <li key={item.session.id}>
                {item.session.kind === "race" || item.session.sport === "other" ? (
                  <SessionChip item={item} view={view} keyNames={keyNames} />
                ) : (
                  <Link
                    to="/week/session"
                    search={{ date: day.date, id: item.session.id }}
                    className="hover:bg-muted/40 flex items-center gap-1 rounded-md"
                  >
                    <span className="min-w-0 flex-1">
                      <SessionChip item={item} view={view} keyNames={keyNames} />
                    </span>
                    <ChevronRightIcon aria-hidden className="text-muted-foreground size-4" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {editable ? (
          <form
            onSubmit={submit}
            className="flex flex-col gap-3 border-t pt-4"
            aria-label="Change this day"
          >
            <span className="text-sm font-medium">Change this day</span>
            <ToggleGroup
              size="sm"
              variant="outline"
              aria-label="What about this day"
              className="grid w-full grid-cols-2"
              value={kind ? [kind] : []}
              onValueChange={(next) =>
                setKind(((next as string[])[0] as ConstraintKind | undefined) ?? null)
              }
            >
              {CONSTRAINT_KINDS.map((item) => {
                const Icon = CONSTRAINT_ICON[item.id];
                return (
                  <ToggleGroupItem key={item.id} value={item.id} className="min-h-10 w-full">
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            {kind === "short" ? (
              <ToggleGroup
                size="sm"
                variant="outline"
                spacing={0}
                aria-label="Time you have"
                value={[String(minutes)]}
                onValueChange={(next) => {
                  const value = (next as string[])[0];
                  if (value) setMinutes(Number(value));
                }}
              >
                {SHORT_WINDOWS.map((window) => (
                  <ToggleGroupItem key={window} value={String(window)}>
                    {formatHours(window / 60)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
            <Textarea
              aria-label="Note for your coach"
              placeholder={
                coach.aiAvailable
                  ? "Storm all afternoon, I'll have 40 min on the trainer…"
                  : "Free text needs the AI coach; the quick choices above work now."
              }
              disabled={!coach.aiAvailable}
              maxLength={500}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={!canSend || add.isPending}
                className="min-h-10 sm:min-h-8"
              >
                {add.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SendIcon data-icon="inline-start" />
                )}
                Re-plan my week
              </Button>
              {!online ? (
                <span className="text-muted-foreground text-xs">
                  Offline: the week shown is the last one saved.
                </span>
              ) : null}
              {add.error ? (
                <span className="text-destructive text-xs">Could not re-plan. Try again.</span>
              ) : null}
            </div>
          </form>
        ) : null}

        {notes.length ? (
          <ul className="flex flex-col gap-2" aria-label="What you told the coach">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  {note.text}
                  {!note.parsed ? (
                    <span className="text-muted-foreground mt-1 block text-xs">
                      Waiting for the coach to read it.
                    </span>
                  ) : null}
                </span>
                {editable ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    aria-label="Remove this note"
                    disabled={remove.isPending || !online}
                    onClick={() => remove.mutate(note.id)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
