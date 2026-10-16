"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { BikeIcon, FootprintsIcon, SparklesIcon } from "lucide-react";

import {
  addDayKey,
  formatHours,
  doneWeekSessions,
  openWeekBucket,
  sessionFitsWindow,
  TIME_WINDOWS,
  WEEKDAYS,
  type PlannedSession,
  type TrainingPlan,
} from "@/services/training-plan.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function restLabel(weekday: number) {
  return WEEKDAYS.find((day) => day.id === weekday)?.label ?? "rest day";
}

function weekRangeLabel(weekStart: string) {
  const start = parseISO(`${weekStart}T12:00:00`);
  const end = parseISO(`${addDayKey(weekStart, 6)}T12:00:00`);
  return `${format(start, "MMM d")}–${format(end, "d")}`;
}

export function WeekPlanBucket({
  sessions,
  weekStart,
  today,
  plan,
  loggedMinutes,
  pending,
  error,
  onFillWeek,
  onSelectSession,
}: {
  sessions: PlannedSession[];
  weekStart: string;
  today: string;
  plan: TrainingPlan;
  loggedMinutes: number;
  pending: boolean;
  error: string | null;
  onFillWeek: () => void;
  onSelectSession: (id: string) => void;
}) {
  const [available, setAvailable] = useState(0);
  const bucket = useMemo(() => openWeekBucket(sessions, weekStart), [sessions, weekStart]);
  const done = useMemo(() => doneWeekSessions(sessions, weekStart), [sessions, weekStart]);
  const targetMinutes = Math.round(plan.targetWeeklyHours * 60);
  const remainingMinutes = bucket.reduce((sum, session) => sum + session.targetMinutes, 0);
  const filled =
    targetMinutes <= 0 ? 0 : Math.min(100, Math.round((loggedMinutes / targetMinutes) * 100));
  const ranked = useMemo(() => {
    const withFit = bucket.map((session) => ({
      session,
      fits: sessionFitsWindow(session.targetMinutes, available),
    }));
    return withFit.sort((left, right) => {
      if (left.fits !== right.fits) return left.fits ? -1 : 1;
      return right.session.targetMinutes - left.session.targetMinutes;
    });
  }, [available, bucket]);
  const weekEnd = addDayKey(weekStart, 6);
  const remainingDays = Math.max(
    0,
    Math.round(
      (Date.parse(`${weekEnd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
    ) + 1,
  );
  const needsStack = bucket.length > remainingDays && remainingDays > 0;

  return (
    <>
      <SheetHeader className="shrink-0 pe-12">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>This week’s bucket</SheetTitle>
          <Badge variant="outline">{weekRangeLabel(weekStart)}</Badge>
        </div>
        <SheetDescription>
          Fill sessions whenever you have time. Preferred rest:{" "}
          {restLabel(plan.preferredRestWeekday)}.
          {needsStack ? " More sessions than days left — stack a couple if you can." : null}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-6 pb-2">
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        <Progress
          value={filled}
          className={
            filled >= 100
              ? "w-full **:data-[slot=progress-indicator]:bg-success"
              : filled >= 50
                ? "w-full **:data-[slot=progress-indicator]:bg-info"
                : "w-full **:data-[slot=progress-indicator]:bg-warning"
          }
        >
          <ProgressLabel>
            {formatHours(loggedMinutes / 60)} logged · {formatHours(remainingMinutes / 60)} still to
            fill of {formatHours(targetMinutes / 60)}
          </ProgressLabel>
        </Progress>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">Time I have today</p>
          <ToggleGroup
            size="sm"
            variant="outline"
            spacing={0}
            value={[String(available)]}
            onValueChange={(next) => {
              const value = next[0];
              if (value == null) return;
              setAvailable(Number(value));
            }}
            className="flex-wrap"
          >
            {TIME_WINDOWS.map((window) => (
              <ToggleGroupItem key={window.minutes} value={String(window.minutes)}>
                {window.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {ranked.length ? (
          <ItemGroup className="gap-2">
            {ranked.map(({ session, fits }) => {
              const SportIcon = session.sportFamily === "cycling" ? BikeIcon : FootprintsIcon;
              return (
                <Item
                  key={session.id}
                  variant="outline"
                  size="sm"
                  render={<button type="button" onClick={() => onSelectSession(session.id)} />}
                  className={
                    fits ? "cursor-pointer text-start" : "cursor-pointer text-start opacity-40"
                  }
                >
                  <ItemMedia variant="icon">
                    <SportIcon
                      className={
                        session.sportFamily === "cycling" ? "text-ds-blue-700" : "text-ds-amber-700"
                      }
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {session.title}
                      {session.status === "adapted" ? <Badge variant="info">Updated</Badge> : null}
                      {available > 0 && fits ? <Badge variant="success">Fits</Badge> : null}
                    </ItemTitle>
                    <ItemDescription>{session.note ?? "Pick any day this week."}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <span className="font-mono text-xs tabular-nums">
                      {formatHours(session.targetMinutes / 60)}
                    </span>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        ) : (
          <Empty className="min-h-24 border">
            <EmptyHeader>
              <EmptyTitle>
                {loggedMinutes > 0 ? "Bucket is clear" : "No sessions in the bucket"}
              </EmptyTitle>
              <EmptyDescription>
                {loggedMinutes > 0
                  ? "This week’s planned run and ride slots are filled. Refresh if you want a new mix."
                  : "Fill the week to drop remaining run and ride sessions here. Then pick what fits today."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {done.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">Logged from Strava</p>
            <ItemGroup className="gap-2">
              {done.map((session) => {
                const SportIcon = session.sportFamily === "cycling" ? BikeIcon : FootprintsIcon;
                return (
                  <Item
                    key={session.id}
                    variant="muted"
                    size="sm"
                    render={<button type="button" onClick={() => onSelectSession(session.id)} />}
                    className="cursor-pointer text-start"
                  >
                    <ItemMedia variant="icon">
                      <SportIcon
                        className={
                          session.sportFamily === "cycling"
                            ? "text-ds-blue-700"
                            : "text-ds-amber-700"
                        }
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {session.title}
                        <Badge variant="success">Done</Badge>
                      </ItemTitle>
                      <ItemDescription>
                        {session.activityTitle
                          ? `${session.activityTitle} · ${format(parseISO(`${session.date}T12:00:00`), "EEE d")}`
                          : format(parseISO(`${session.date}T12:00:00`), "EEE d")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <span className="font-mono text-xs tabular-nums">
                        {formatHours(session.targetMinutes / 60)}
                      </span>
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          </div>
        ) : null}
      </div>
      <SheetFooter className="shrink-0">
        <Button type="button" variant="outline" disabled={pending} onClick={onFillWeek}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SparklesIcon data-icon="inline-start" />
          )}
          {bucket.length ? "Refresh week" : "Fill week"}
        </Button>
      </SheetFooter>
    </>
  );
}
