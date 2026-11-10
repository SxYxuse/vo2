"use client";

import { useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CalendarDaysIcon, FlagIcon, HeartOffIcon } from "lucide-react";

import { prefetchActivityDetail } from "@/lib/prefetch.ts";
import {
  formatSportType,
  sportTypeColor,
  type SportTypeSettings,
} from "@/services/athlete-settings.types.ts";
import { formatDistanceKm, formatDuration } from "@/services/activity-detail.ts";
import {
  isMissingHeartrate,
  type CalendarActivity,
  type CalendarGoal,
} from "@/services/home-data.types.ts";
import { addDayKey, dayKey } from "@/services/day-key.ts";
import type { DiarySearch } from "@/services/diary-window.ts";

/*
 * The phone calendar's other layouts, chosen in Settings → Calendar while the athlete finds the
 * one that suits them. Each reads day keys ("2026-11-10") in the athlete's time zone, like the
 * jump picker, so none of them needs the event calendar's own layout engine.
 */

type Day = { activities: CalendarActivity[]; goals: CalendarGoal[] };
type ByDay = Map<string, Day>;

/** Activities and goals by day key, activities in start order. */
export function useItemsByDay(
  activities: CalendarActivity[],
  goals: CalendarGoal[],
  timeZone: string,
): ByDay {
  return useMemo(() => {
    const byDay: ByDay = new Map();
    const day = (key: string) => {
      let entry = byDay.get(key);
      if (!entry) byDay.set(key, (entry = { activities: [], goals: [] }));
      return entry;
    };
    for (const activity of activities)
      day(dayKey(new Date(activity.start), timeZone)).activities.push(activity);
    for (const goal of goals) day(goal.date).goals.push(goal);
    for (const entry of byDay.values())
      entry.activities.sort((a, b) => a.start.localeCompare(b.start));
    return byDay;
  }, [activities, goals, timeZone]);
}

const weekDays = (week: string) => Array.from({ length: 7 }, (_, i) => addDayKey(week, i));

const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const weekdayOf = (key: string) => WEEKDAY.format(keyDate(key));
const dayOf = (key: string) => Number(key.slice(8));

/** "1 h 35", "45 min". */
function formatHours(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

type Totals = { count: number; movingTime: number; distance: number };

function totalsOf(byDay: ByDay, days: string[]): Totals {
  const totals = { count: 0, movingTime: 0, distance: 0 };
  for (const key of days) {
    for (const activity of byDay.get(key)?.activities ?? []) {
      totals.count += 1;
      totals.movingTime += activity.movingTime;
      totals.distance += activity.distance ?? 0;
    }
  }
  return totals;
}

function totalsLine({ count, movingTime, distance }: Totals) {
  return [
    `${count} ${count === 1 ? "activity" : "activities"}`,
    formatHours(movingTime),
    distance > 0 ? formatDistanceKm(distance) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

type RowProps = { sportTypes: SportTypeSettings; search: DiarySearch; showDay?: boolean };

function ActivityRow({
  activity,
  sportTypes,
  search,
  showDay,
  timeZone,
}: RowProps & {
  activity: CalendarActivity;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const key = dayKey(new Date(activity.start), timeZone);
  const meta = [
    formatDuration(activity.movingTime),
    activity.distance != null ? formatDistanceKm(activity.distance) : null,
    formatSportType(activity.sportType),
  ].filter(Boolean);
  return (
    <Link
      to="/activities/$activityId"
      params={{ activityId: activity.id }}
      search={search}
      data-event-id={activity.id}
      onPointerDown={() => prefetchActivityDetail(queryClient, activity.id)}
      className="hover:bg-accent/40 focus-visible:bg-accent/40 flex min-h-[2.75rem] items-center gap-3 px-4 py-2.5 outline-none"
    >
      {showDay ? <DayStamp dayKey={key} /> : null}
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: sportTypeColor(sportTypes, activity.sportType) }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-medium">{activity.title}</span>
          {isMissingHeartrate(activity) ? (
            <HeartOffIcon aria-label="No heart rate" className="text-warning size-3 shrink-0" />
          ) : null}
        </span>
        <span className="text-muted-foreground truncate text-xs">{meta.join(" · ")}</span>
      </span>
    </Link>
  );
}

function GoalRow({ goal, sportTypes, showDay }: Omit<RowProps, "search"> & { goal: CalendarGoal }) {
  return (
    <Link
      to="/season"
      className="hover:bg-accent/40 focus-visible:bg-accent/40 flex min-h-[2.75rem] items-center gap-3 px-4 py-2.5 outline-none"
    >
      {showDay ? <DayStamp dayKey={goal.date} /> : null}
      <FlagIcon
        aria-hidden
        className="size-3.5 shrink-0"
        style={{ color: sportTypeColor(sportTypes, goal.sportType) }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{goal.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          Goal · {formatSportType(goal.sportType)}
        </span>
      </span>
    </Link>
  );
}

function DayStamp({ dayKey: key }: { dayKey: string }) {
  return (
    <span className="text-muted-foreground flex w-8 shrink-0 flex-col items-center text-[0.625rem] leading-tight uppercase">
      {weekdayOf(key)}
      <span className="text-foreground text-sm font-semibold">{dayOf(key)}</span>
    </span>
  );
}

/** The days' goals and activities, newest day first, each row stamped with its day. */
function DayRows({
  days,
  byDay,
  sportTypes,
  search,
  timeZone,
}: RowProps & { days: string[]; byDay: ByDay; timeZone: string }) {
  const rows: ReactNode[] = [];
  for (const key of [...days].reverse()) {
    const day = byDay.get(key);
    for (const goal of day?.goals ?? []) {
      rows.push(<GoalRow key={`goal-${goal.id}`} goal={goal} sportTypes={sportTypes} showDay />);
    }
    for (const activity of [...(day?.activities ?? [])].reverse()) {
      rows.push(
        <ActivityRow
          key={activity.id}
          activity={activity}
          sportTypes={sportTypes}
          search={search}
          timeZone={timeZone}
          showDay
        />,
      );
    }
  }
  return rows.length ? <div className="divide-y border-t">{rows}</div> : null;
}

/** An empty week says so once, with last week for comparison, instead of seven rest days. */
function EmptyWeek({ thisWeek, previous }: { thisWeek: boolean; previous: Totals }) {
  return (
    <div className="flex flex-col items-center gap-1 border-t px-4 py-8 text-center">
      <CalendarDaysIcon aria-hidden className="text-muted-foreground mb-1 size-5" />
      <p className="text-sm font-medium">
        {thisWeek ? "No activities this week yet" : "No activities this week"}
      </p>
      <p className="text-muted-foreground text-xs">
        {previous.count
          ? `The week before: ${totalsLine(previous)}.`
          : "Nothing the week before either."}
      </p>
    </div>
  );
}

function SportDots({ day, sportTypes }: { day: Day | undefined; sportTypes: SportTypeSettings }) {
  const sports = [...new Set(day?.activities.map((activity) => activity.sportType) ?? [])];
  return (
    <span aria-hidden className="flex h-1.5 items-center gap-0.5">
      {day?.goals.length ? <FlagIcon className="size-2" /> : null}
      {sports.slice(0, 3).map((sport) => (
        <span
          key={sport}
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: sportTypeColor(sportTypes, sport) }}
        />
      ))}
    </span>
  );
}

type WeekViewProps = RowProps & {
  week: string;
  byDay: ByDay;
  timeZone: string;
  todayKey: string;
};

/** Week strip: the week's days in a row with a dot per sport, then only what was done. */
export function WeekStripView({
  week,
  byDay,
  timeZone,
  todayKey,
  sportTypes,
  search,
}: WeekViewProps) {
  const days = weekDays(week);
  const totals = totalsOf(byDay, days);
  return (
    <div className="flex flex-col">
      <ol aria-label="Days of the week" className="grid grid-cols-7 gap-0.5 px-2 pb-2">
        {days.map((key) => {
          const day = byDay.get(key);
          const today = key === todayKey;
          const count = day?.activities.length ?? 0;
          return (
            <li
              key={key}
              aria-label={`${weekdayOf(key)} ${dayOf(key)}: ${count ? `${count} ${count === 1 ? "activity" : "activities"}` : "rest"}`}
              aria-current={today ? "date" : undefined}
              className={cn(
                "text-muted-foreground flex flex-col items-center gap-1 rounded-lg py-1.5 text-[0.625rem]",
                today && "bg-primary text-primary-foreground/70",
              )}
            >
              {weekdayOf(key)}
              <span
                className={cn(
                  "text-foreground text-sm font-semibold",
                  today && "text-primary-foreground",
                )}
              >
                {dayOf(key)}
              </span>
              <SportDots day={day} sportTypes={sportTypes} />
            </li>
          );
        })}
      </ol>
      {totals.count || days.some((key) => byDay.get(key)?.goals.length) ? (
        <>
          <DayRows
            days={days}
            byDay={byDay}
            sportTypes={sportTypes}
            search={search}
            timeZone={timeZone}
          />
          <p className="text-muted-foreground border-t px-4 py-2 text-center text-xs">
            {totalsLine(totals)}
          </p>
        </>
      ) : (
        <EmptyWeek
          thisWeek={days.includes(todayKey)}
          previous={totalsOf(byDay, weekDays(addDayKey(week, -7)))}
        />
      )}
    </div>
  );
}

/** Week summary: the week's totals and a bar per day, coloured by sport, then the activities. */
export function WeekSummaryView({
  week,
  byDay,
  timeZone,
  todayKey,
  sportTypes,
  search,
}: WeekViewProps) {
  const days = weekDays(week);
  const totals = totalsOf(byDay, days);
  const dayTime = days.map((key) =>
    (byDay.get(key)?.activities ?? []).reduce((sum, activity) => sum + activity.movingTime, 0),
  );
  const longest = Math.max(...dayTime, 1);
  return (
    <div className="flex flex-col">
      <dl className="grid grid-cols-3 gap-2 px-4 pb-1">
        {[
          ["Time", formatHours(totals.movingTime)],
          ["Distance", totals.distance ? formatDistanceKm(totals.distance) : "0 km"],
          ["Activities", String(totals.count)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div aria-hidden className="grid h-16 grid-cols-7 items-end gap-1.5 px-4 pt-2">
        {days.map((key, index) => (
          <div
            key={key}
            className="bg-muted flex flex-col-reverse overflow-hidden rounded-sm"
            style={{ height: `${Math.max(4, (dayTime[index]! / longest) * 100)}%` }}
          >
            {(byDay.get(key)?.activities ?? []).map((activity) => (
              <span
                key={activity.id}
                style={{
                  height: `${(activity.movingTime / Math.max(dayTime[index]!, 1)) * 100}%`,
                  backgroundColor: sportTypeColor(sportTypes, activity.sportType),
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="text-muted-foreground grid grid-cols-7 gap-1.5 px-4 pt-1 pb-3 text-center text-[0.625rem]"
      >
        {days.map((key) => (
          <span key={key} className={cn(key === todayKey && "text-foreground font-bold")}>
            {weekdayOf(key).charAt(0)}
          </span>
        ))}
      </div>
      {totals.count || days.some((key) => byDay.get(key)?.goals.length) ? (
        <DayRows
          days={days}
          byDay={byDay}
          sportTypes={sportTypes}
          search={search}
          timeZone={timeZone}
        />
      ) : (
        <EmptyWeek
          thisWeek={days.includes(todayKey)}
          previous={totalsOf(byDay, weekDays(addDayKey(week, -7)))}
        />
      )}
    </div>
  );
}
