"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import {
  BanIcon,
  ClockIcon,
  FlagIcon,
  HouseIcon,
  LeafIcon,
  MoonIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";

import { weekCoachQueryOptions } from "@/lib/queries.ts";
import { addCoachNote, removeCoachNote, replanWeek } from "@/services/week-coach.ts";
import {
  CONSTRAINT_KINDS,
  constraintsOn,
  type ConstraintKind,
  type PlannedDay,
  type WeekCoachState,
} from "@/services/week-plan.ts";
import { addDayKey, formatHours, keySessionName } from "@/services/training-plan.types.ts";
import type { WeekActivity, WeekSummary, WeekTargetData } from "@/services/week-target.ts";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const CONSTRAINT_ICON: Record<ConstraintKind, typeof BanIcon> = {
  off: BanIcon,
  short: ClockIcon,
  indoor: HouseIcon,
  easy: LeafIcon,
};

const SHORT_WINDOWS = [30, 45, 60, 90] as const;

/** Outline colour of a planned day, matching the sport colours in SPORT_STYLE. */
const SPORT_OUTLINE: Record<string, string> = {
  cycling: "var(--ds-blue-700)",
  running: "var(--ds-amber-700)",
  swimming: "var(--ds-teal-700)",
  walking: "var(--ds-green-700)",
};

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
 * Asks the coach again when the stored plan predates a sync or a note. The server answers from
 * storage when nothing changed, so this costs a model call only when the week did.
 */
export function useReplanWhenStale(coach: WeekCoachState | undefined) {
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

function dayLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDayKey(today, 1)) return "Tomorrow";
  return format(parseISO(`${date}T12:00:00`), "EEE d");
}

function plannedLabel(day: PlannedDay, summary: WeekSummary) {
  if (day.kind === "race") return "Race";
  if (day.kind === "rest") return "Rest";
  if (day.keySessionId === "opener") return "Opener";
  if (day.kind === "key") {
    const status = summary.keySessions.find((item) => item.session.id === day.keySessionId);
    return status?.session.kind === "long" ? "Long" : "Key";
  }
  return day.kind === "recovery" ? "Recovery" : "Easy";
}

/**
 * Monday to Sunday: what is done (solid) and what the plan puts on each day left (outlined).
 * Tapping a day opens the note form on it.
 */
export function WeekStrip({
  data,
  summary,
  coach,
  onPickDay,
}: {
  data: WeekTargetData;
  summary: WeekSummary;
  coach: WeekCoachState | undefined;
  onPickDay: (date: string) => void;
}) {
  const constraints = coach?.notes.flatMap((note) => note.constraints) ?? [];
  const byDate = new Map<string, WeekActivity[]>();
  for (const activity of data.activities) {
    byDate.set(activity.date, [...(byDate.get(activity.date) ?? []), activity]);
  }
  const planned = new Map(coach?.plan?.days.map((day) => [day.date, day]) ?? []);
  const dates = Array.from({ length: 7 }, (_, index) => addDayKey(data.weekStart, index));

  return (
    <div className="grid grid-cols-7 gap-1" role="list" aria-label="This week by day">
      {dates.map((date) => {
        const done = byDate.get(date) ?? [];
        const plan = planned.get(date);
        const limits = constraintsOn(constraints, date);
        const past = date < data.today;
        const isToday = date === data.today;
        const icons = (Object.keys(CONSTRAINT_ICON) as ConstraintKind[]).filter((kind) =>
          kind === "off" ? limits.off : kind === "short" ? limits.cap != null : limits[kind],
        );
        return (
          <button
            key={date}
            type="button"
            role="listitem"
            disabled={past}
            onClick={() => onPickDay(date)}
            aria-label={`${format(parseISO(`${date}T12:00:00`), "EEEE")}: ${
              done.length
                ? done.map((activity) => activity.title).join(", ")
                : plan
                  ? `${plannedLabel(plan, summary)} ${plan.minutes ? formatHours(plan.minutes / 60) : ""}`
                  : "nothing"
            }`}
            className={cn(
              "flex min-h-20 min-w-0 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 text-center text-[10px]",
              isToday ? "bg-muted" : !past && "hover:bg-muted/50",
              past && !done.length && "opacity-50",
            )}
          >
            <span className="font-semibold">{format(parseISO(`${date}T12:00:00`), "EEEEE")}</span>
            {done.map((activity) => (
              <span key={activity.id} className="flex flex-col items-center">
                <span
                  className={cn("size-2.5 rounded-full", SPORT_STYLE[activity.family].bar)}
                  aria-hidden
                />
                <span className="font-mono tabular-nums">{formatHours(activity.minutes / 60)}</span>
              </span>
            ))}
            {!done.length && plan ? (
              <span className="flex flex-col items-center">
                {plan.kind === "race" ? (
                  <FlagIcon className="size-3" aria-hidden />
                ) : plan.kind === "rest" ? (
                  <MoonIcon className="text-muted-foreground size-3" aria-hidden />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 rounded-full border-2",
                      plan.kind === "key" ? "border-solid" : "border-dashed",
                    )}
                    style={{
                      borderColor: SPORT_OUTLINE[plan.sport ?? ""] ?? "var(--muted-foreground)",
                    }}
                  />
                )}
                <span className="text-muted-foreground">{plannedLabel(plan, summary)}</span>
                {plan.minutes ? (
                  <span className="font-mono tabular-nums">{formatHours(plan.minutes / 60)}</span>
                ) : null}
              </span>
            ) : null}
            {icons.length ? (
              <span className="text-muted-foreground mt-auto flex gap-0.5" aria-hidden>
                {icons.map((kind) => {
                  const Icon = CONSTRAINT_ICON[kind];
                  return <Icon key={kind} className="size-3" />;
                })}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** One planned day in words, for the list under the strip. */
function PlannedRow({
  day,
  data,
  summary,
}: {
  day: PlannedDay;
  data: WeekTargetData;
  summary: WeekSummary;
}) {
  const status = summary.keySessions.find((item) => item.session.id === day.keySessionId);
  const sport =
    day.sport && day.sport in SPORT_STYLE
      ? SPORT_STYLE[day.sport as keyof typeof SPORT_STYLE]
      : null;
  const title =
    day.kind === "race"
      ? (day.note ?? "Race")
      : day.kind === "rest"
        ? "Rest"
        : day.keySessionId === "opener"
          ? "Opener · 3 × 1 min"
          : status
            ? keySessionName(status.session)
            : `${day.kind === "recovery" ? "Recovery" : "Easy"} ${sport?.label.toLowerCase() ?? "session"}`;
  const linkable = status && !status.done;
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground w-16 shrink-0 text-xs">
        {dayLabel(day.date, data.today)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {linkable ? (
            <Link
              to="/week/session"
              search={{ key: status.session.id }}
              className="font-medium hover:underline"
            >
              {title}
            </Link>
          ) : (
            <span className="font-medium">{title}</span>
          )}
          {sport && day.kind === "key" ? (
            <span className={cn("text-xs", sport.text)}>{sport.label}</span>
          ) : null}
          {day.indoor && day.kind !== "rest" ? (
            <Badge variant="outline" className="h-5">
              Indoor
            </Badge>
          ) : null}
        </span>
        {day.kind !== "race" && day.note ? (
          <span className="text-muted-foreground block text-xs">{day.note}</span>
        ) : null}
      </span>
      {day.minutes ? (
        <span className="shrink-0 font-mono text-xs tabular-nums">
          {formatHours(day.minutes / 60)}
        </span>
      ) : null}
    </li>
  );
}

/** The coach: the week laid out on days, its note, and what the athlete told it. */
export function CoachCard({
  data,
  summary,
  coach,
  replanning,
  pickedDay,
  onPickDay,
}: {
  data: WeekTargetData;
  summary: WeekSummary;
  coach: WeekCoachState | undefined;
  replanning: boolean;
  pickedDay: string | null;
  onPickDay: (date: string | null) => void;
}) {
  const plan = coach?.plan;
  const days = plan?.days ?? [];
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Your week, day by day
          {replanning ? (
            <Badge variant="outline">
              <Spinner data-icon="inline-start" />
              Re-planning
            </Badge>
          ) : plan ? (
            <Badge variant="outline">
              {plan.source === "coach" ? <SparklesIcon data-icon="inline-start" /> : null}
              {plan.source === "coach" ? "AI coach" : "Planner"}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          VO2 sets how much and which key sessions; the coach places them around your days. Tap a
          day to tell it something.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <WeekStrip data={data} summary={summary} coach={coach} onPickDay={onPickDay} />
        {plan?.note ? <p className="text-muted-foreground text-sm">{plan.note}</p> : null}
        {days.length ? (
          <ul className="divide-y">
            {days.map((day) => (
              <PlannedRow key={day.date} day={day} data={data} summary={summary} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing left to plan this week.</p>
        )}
        <TellCoach
          data={data}
          coach={coach}
          pickedDay={pickedDay}
          onPickDay={onPickDay}
          dates={days.map((day) => day.date)}
        />
      </CardContent>
    </Card>
  );
}

function TellCoach({
  data,
  coach,
  dates,
  pickedDay,
  onPickDay,
}: {
  data: WeekTargetData;
  coach: WeekCoachState | undefined;
  dates: string[];
  pickedDay: string | null;
  onPickDay: (date: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const options = dates.length ? dates : [data.today];
  const date = pickedDay && options.includes(pickedDay) ? pickedDay : options[0]!;
  const [kind, setKind] = useState<ConstraintKind | null>(null);
  const [minutes, setMinutes] = useState<number>(45);
  const [text, setText] = useState("");
  const aiAvailable = coach?.aiAvailable ?? false;
  const settle = (state: WeekCoachState) =>
    queryClient.setQueryData(weekCoachQueryOptions.queryKey, state);
  const add = useMutation({
    mutationFn: () =>
      addCoachNote({
        data: { date, kind, minutes: kind === "short" ? minutes : null, text: text.trim() },
      }),
    onSuccess: (state) => {
      settle(state);
      setKind(null);
      setText("");
      onPickDay(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCoachNote({ data: { id } }),
    onSuccess: settle,
  });
  const canSend = online && (kind != null || (aiAvailable && text.trim().length > 0));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSend) add.mutate();
  }

  const notes = coach?.notes ?? [];
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Tell your coach">
        <span className="text-sm font-medium">Tell your coach</span>
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          aria-label="Day"
          className="flex-wrap"
          value={[date]}
          onValueChange={(next) => {
            if (next[0]) onPickDay(next[0]);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {dayLabel(option, data.today)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          aria-label="What about that day"
          className="flex-wrap"
          value={kind ? [kind] : []}
          onValueChange={(next) => setKind((next[0] as ConstraintKind | undefined) ?? null)}
        >
          {CONSTRAINT_KINDS.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {kind === "short" ? (
          <ToggleGroup
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="Time you have"
            value={[String(minutes)]}
            onValueChange={(next) => {
              if (next[0]) setMinutes(Number(next[0]));
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
            aiAvailable
              ? "Storm all afternoon, I'll have 40 min on the trainer…"
              : "Free text needs the AI coach; the quick choices above work now."
          }
          disabled={!aiAvailable}
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
              Offline: the plan below is the last one saved.
            </span>
          ) : null}
          {add.error ? (
            <span className="text-destructive text-xs">Could not reach the coach. Try again.</span>
          ) : null}
        </div>
      </form>
      {notes.length ? (
        <ul className="flex flex-col gap-2" aria-label="What you told the coach">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">
                <span className="text-muted-foreground text-xs">
                  {dayLabel(note.date, data.today)} ·{" "}
                </span>
                {note.text}
                {note.constraints.length ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {note.constraints.map((item) => {
                      const Icon = CONSTRAINT_ICON[item.kind];
                      return (
                        <Badge key={`${item.date}:${item.kind}`} variant="outline" className="h-5">
                          <Icon data-icon="inline-start" />
                          {dayLabel(item.date, data.today)} ·{" "}
                          {CONSTRAINT_KINDS.find((kindItem) => kindItem.id === item.kind)?.label}
                          {item.minutes ? ` ${item.minutes} min` : ""}
                        </Badge>
                      );
                    })}
                  </span>
                ) : !note.parsed ? (
                  <span className="text-muted-foreground mt-1 block text-xs">
                    Waiting for the coach to read it.
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove this note"
                disabled={remove.isPending || !online}
                onClick={() => remove.mutate(note.id)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
