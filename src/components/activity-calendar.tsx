"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  HeartOffIcon,
} from "lucide-react";

import { prefetchActivityDetail, prefetchActivityDetails } from "@/lib/prefetch.ts";
import { useDesktopMedia } from "@/components/responsive-dialog.tsx";
import { DiaryJumpPicker } from "@/components/diary-jump-picker.tsx";
import { useWeekSwipe } from "@/hooks/use-week-swipe.ts";
import {
  formatSportType,
  sportTypeColor,
  type AthleteSettings,
} from "@/services/athlete-settings.types.ts";
import {
  formatActivityClockRange,
  formatDistanceKm,
  formatDuration,
} from "@/services/activity-detail.ts";
import {
  isMissingHeartrate,
  type CalendarActivity,
  type CalendarGoal,
} from "@/services/home-data.types.ts";
import {
  diaryTotals,
  diaryWindow,
  formatDiaryMonth,
  formatDiaryRange,
  lastWeekOfMonth,
  monthKey,
  monthLandingWeek,
  monthOfWeek,
  resolveDiaryCursorMonth,
  resolveDiaryCursorWeek,
  stepDiaryMonth,
  stepDiaryWeek,
  type DiarySearch,
} from "@/services/diary-window.ts";
import { weekStartKey } from "@/services/day-key.ts";
import {
  EventCalendar,
  EventCalendarViewContext,
  useEventCalendar,
  useEventCalendarNavigation,
  useEventCalendarSelector,
  useEventCalendarSettings,
  useEventCalendarViewConfig,
  type EventCalendarRenderEventProps,
} from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { EventCalendarEvent } from "@/components/reui/event-calendar/event-calendar-event";
import { EventCalendarMonthView } from "@/components/reui/event-calendar/event-calendar-month-view";
import {
  getDayKey,
  getRangeKey,
  toZoned,
  zonedStartOfDay,
} from "@/components/reui/event-calendar/event-calendar-lib";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarDateRange,
} from "@/components/reui/event-calendar/event-calendar-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

const DISABLED_INTERACTIONS = { drag: false, resize: false, selectSlot: false } as const;
const DIARY_VIEWS: CalendarView[] = ["month", "days"];
const MONDAY = 1;
const DESKTOP_WEEKS = 4;
const MOBILE_WEEKS = 1;

function MissingHeartrateMark() {
  return (
    <HeartOffIcon
      data-slot="activity-missing-heartrate"
      className="text-warning size-2.5 shrink-0"
      aria-hidden
    />
  );
}

/** Goals share the calendar with activities; their event ids carry this prefix. */
const GOAL_ID_PREFIX = "goal:";

type CalendarItem = CalendarActivity | CalendarGoal;

function isGoal(item: CalendarItem | undefined): item is CalendarGoal {
  return item != null && "date" in item;
}

function warmActivity(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  if (id.startsWith(GOAL_ID_PREFIX)) return;
  prefetchActivityDetail(queryClient, id);
}

function GoalMark() {
  return <FlagIcon aria-hidden className="size-3 shrink-0 text-(--ec-event-color)" />;
}

function CalendarEventChip({
  occurrence,
}: {
  occurrence: EventCalendarRenderEventProps<CalendarItem>["occurrence"];
}) {
  const queryClient = useQueryClient();
  const activity = occurrence.event.data;
  if (isGoal(activity)) {
    return (
      <span className="contents">
        <GoalMark />
        <span className="hidden truncate font-semibold sm:inline">{activity.name}</span>
      </span>
    );
  }
  return (
    <span
      className="contents"
      onPointerEnter={() => warmActivity(queryClient, occurrence.event.id)}
      onPointerDown={() => warmActivity(queryClient, occurrence.event.id)}
      onFocus={() => warmActivity(queryClient, occurrence.event.id)}
    >
      <span
        aria-hidden
        data-slot="event-calendar-event-dot"
        className="-me-0.5 size-1.5 shrink-0 rounded-full bg-(--ec-event-color)"
      />
      <span className="hidden truncate font-medium sm:inline">{occurrence.event.title}</span>
      {activity && isMissingHeartrate(activity) ? <MissingHeartrateMark /> : null}
    </span>
  );
}

function renderCalendarEvent({ occurrence }: EventCalendarRenderEventProps<CalendarItem>) {
  return <CalendarEventChip occurrence={occurrence} />;
}

function renderCalendarEventTooltip({
  occurrence,
}: {
  occurrence: EventCalendarRenderEventProps<CalendarItem>["occurrence"];
}) {
  const activity = occurrence.event.data;
  if (!activity) return occurrence.event.title;
  if (isGoal(activity)) return `Goal · ${activity.name} · ${formatSportType(activity.sportType)}`;
  const when = formatActivityClockRange(activity.start, activity.end);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <span className="font-medium">{activity.title}</span>
        {isMissingHeartrate(activity) ? <MissingHeartrateMark /> : null}
      </span>
      {when ? <span>{when}</span> : null}
      {isMissingHeartrate(activity) ? <span>No heart rate</span> : null}
    </span>
  );
}

function AgendaEventRow({
  occurrence,
}: {
  occurrence: EventCalendarRenderEventProps<CalendarItem>["occurrence"];
}) {
  const queryClient = useQueryClient();
  const item = occurrence.event.data;
  if (isGoal(item)) {
    return (
      <span className="contents">
        <GoalMark />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{item.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            Goal · {formatSportType(item.sportType)}
          </span>
        </span>
      </span>
    );
  }
  const activity = item;
  const when = activity ? formatActivityClockRange(activity.start, activity.end) : "";
  const meta = activity
    ? [
        when,
        formatDuration(activity.movingTime),
        activity.distance != null ? formatDistanceKm(activity.distance) : null,
        formatSportType(activity.sportType),
      ].filter(Boolean)
    : [];
  return (
    <span
      className="contents"
      onPointerEnter={() => warmActivity(queryClient, occurrence.event.id)}
      onPointerDown={() => warmActivity(queryClient, occurrence.event.id)}
      onFocus={() => warmActivity(queryClient, occurrence.event.id)}
    >
      <span
        aria-hidden
        data-slot="event-calendar-agenda-dot"
        className="size-2 shrink-0 rounded-full bg-(--ec-event-color)"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-medium">{occurrence.event.title}</span>
          {activity && isMissingHeartrate(activity) ? <MissingHeartrateMark /> : null}
        </span>
        {meta.length ? (
          <span className="text-muted-foreground truncate text-xs">{meta.join(" · ")}</span>
        ) : null}
      </span>
    </span>
  );
}

function renderAgendaEvent({ occurrence }: EventCalendarRenderEventProps<CalendarItem>) {
  return <AgendaEventRow occurrence={occurrence} />;
}

function VisibleActivitiesPrefetch({ activities }: { activities: CalendarActivity[] }) {
  const queryClient = useQueryClient();
  const { activeRange } = useEventCalendarNavigation();
  useEffect(() => {
    const startMs = activeRange.start.getTime();
    const endMs = activeRange.end.getTime();
    const ids = activities
      .filter((activity) => {
        const startedAt = new Date(activity.start).getTime();
        return startedAt >= startMs && startedAt < endMs;
      })
      .map((activity) => activity.id);
    prefetchActivityDetails(queryClient, ids);
  }, [activities, activeRange.end, activeRange.start, queryClient]);
  return null;
}

/** Vertical day list of one training week: ReUI agenda rows plus rest days, for phone widths. */
function ActivityDayListView() {
  const todayRef = useRef<HTMLDivElement | null>(null);
  const instance = useEventCalendar();
  const settings = useEventCalendarSettings();
  const viewConfig = useEventCalendarViewConfig();
  const visibleRange = useEventCalendarSelector<unknown, EventCalendarDateRange>(
    (state) => state.activeRange,
    {
      isEqual: (a, b) => getRangeKey(a) === getRangeKey(b),
    },
  );
  useEventCalendarSelector((state) => state.events);

  const days = useMemo(() => {
    const result: Date[] = [];
    let cursor = zonedStartOfDay(visibleRange.start, settings.timeZone);
    while (cursor < visibleRange.end) {
      result.push(cursor);
      cursor = zonedStartOfDay(addDays(toZoned(cursor, settings.timeZone), 1), settings.timeZone);
    }
    return result;
  }, [visibleRange, settings.timeZone]);

  useEffect(() => {
    const day = todayRef.current;
    const viewport = day?.closest<HTMLElement>(
      '[data-slot="scroll-area-viewport"], [data-slot="event-calendar-week-list-scroll"]',
    );
    if (!day || !viewport) return;
    viewport.scrollTop += day.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  }, [visibleRange]);

  const index = instance.internals.getIndex();
  const native = viewConfig.scrollbars === "native";

  // pan-y: the browser scrolls the days, but a sideways swipe stays the week change (useWeekSwipe)
  // instead of becoming back navigation.
  const body = (
    <div className="isolate flex touch-pan-y flex-col [&>*:last-child>*:last-child]:border-b-0">
      {days.map((day) => {
        const bucket = index.byDay.get(getDayKey(day, settings.timeZone));
        const items = [...(bucket?.allDay ?? []), ...(bucket?.timed ?? [])];
        const zoned = toZoned(day, settings.timeZone);
        const weekday = format(zoned, "EEE", { locale: settings.locale });
        const dayDate = format(zoned, "MMM d", { locale: settings.locale });
        const today =
          getDayKey(day, settings.timeZone) === getDayKey(new Date(), settings.timeZone);
        return (
          <div
            key={day.getTime()}
            ref={today ? todayRef : undefined}
            role="group"
            aria-label={`${weekday}, ${dayDate}`}
            data-today={today || undefined}
          >
            <div className="bg-muted/60 sticky top-0 z-10 flex items-baseline justify-between gap-4 border-b px-4 py-2">
              <span className="flex items-baseline gap-2">
                <span className="font-semibold">{weekday}</span>
                {today ? (
                  <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[0.6875rem] font-medium">
                    Today
                  </span>
                ) : null}
                {/* A day with nothing done says so in its header, so the week fits on screen. */}
                {items.length === 0 ? (
                  <span className="text-muted-foreground font-normal">Rest</span>
                ) : null}
              </span>
              <span className="text-muted-foreground font-medium tabular-nums">{dayDate}</span>
            </div>
            {items.length === 0
              ? null
              : items.map((segment) => (
                  <EventCalendarEvent
                    key={segment.occurrence.key}
                    segment={segment}
                    className="hover:bg-accent/40 gap-3 rounded-none border-b px-4 py-2.5"
                  />
                ))}
          </div>
        );
      })}
    </div>
  );

  return (
    <EventCalendarViewContext.Provider value={{ view: "agenda" }}>
      <div
        data-slot="event-calendar-week-list"
        className="flex min-h-0 flex-1 flex-col overflow-hidden border-t"
      >
        {native ? (
          <div data-slot="event-calendar-week-list-scroll" className="h-full overflow-y-auto">
            {body}
          </div>
        ) : (
          <ScrollArea className="h-full">{body}</ScrollArea>
        )}
      </div>
    </EventCalendarViewContext.Provider>
  );
}

function dayKeyDate(key: string, timeZone: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new TZDate(year, month - 1, day, timeZone);
}

function DiaryNav({
  label,
  unit,
  atPresent,
  onStep,
  onToday,
  onJump,
}: {
  label: string;
  unit: string;
  atPresent: boolean;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
  /** Opens the jump picker; absent before the first activity is synced. */
  onJump?: () => void;
}) {
  return (
    // Phones lead with the range and keep Today and the arrows together at the right edge.
    <div className="flex min-w-0 items-center gap-1 px-2 py-2 sm:flex-wrap">
      <Button variant="ghost" size="sm" onClick={onToday}>
        Today
      </Button>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Previous ${unit}`}
          onClick={() => onStep(-1)}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Next ${unit}`}
          disabled={atPresent}
          onClick={() => onStep(1)}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
      {onJump ? (
        <Button
          variant="secondary"
          size="sm"
          aria-live="polite"
          aria-haspopup="dialog"
          className="min-w-0 font-semibold max-sm:order-first max-sm:me-auto sm:ms-1"
          onClick={onJump}
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon aria-hidden className="text-muted-foreground" />
        </Button>
      ) : (
        <div
          aria-live="polite"
          className="min-w-0 truncate text-sm font-semibold max-sm:order-first max-sm:me-auto max-sm:px-2 sm:ms-3"
        >
          {label}
        </div>
      )}
    </div>
  );
}

type ActivityCalendarProps = {
  activities: CalendarActivity[];
  goals: CalendarGoal[];
  initialSettings: AthleteSettings;
  diary: DiarySearch;
};

export function ActivityCalendar({
  activities,
  goals,
  initialSettings,
  diary,
}: ActivityCalendarProps) {
  const sportTypes = initialSettings.sportTypes;
  const isDesktopMedia = useDesktopMedia();
  const layoutReady = isDesktopMedia !== null;
  const isDesktop = isDesktopMedia === true;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // Phones always page one training week; desktop follows the athlete's calendar period.
  const byMonth = isDesktop && initialSettings.calendarPeriod !== "weeks";
  const weeks = isDesktop ? DESKTOP_WEEKS : MOBILE_WEEKS;
  const currentMonth = useMemo(() => monthKey(new Date(), timeZone), [timeZone]);
  const currentWeek = useMemo(() => weekStartKey(new Date(), timeZone), [timeZone]);
  // A link from the other view keeps its place in time.
  const cursorMonth = resolveDiaryCursorMonth(
    diary.month ?? (diary.week ? monthOfWeek(diary.week) : undefined),
    currentMonth,
  );
  const cursorWeek = resolveDiaryCursorWeek(
    diary.week ?? (diary.month ? lastWeekOfMonth(diary.month) : undefined),
    currentWeek,
  );
  const weekRange = diaryWindow(cursorWeek, weeks);
  const [jumping, setJumping] = useState(false);
  const [jumpKey, setJumpKey] = useState(0);
  const totals = useMemo(() => diaryTotals(activities, timeZone), [activities, timeZone]);
  const anchor = useMemo(
    () => dayKeyDate(byMonth ? `${cursorMonth}-01` : weekRange.start, timeZone),
    [byMonth, cursorMonth, weekRange.start, timeZone],
  );
  const cursor: DiarySearch = byMonth ? { month: cursorMonth } : { week: cursorWeek };
  // The present stays out of the URL so a bare "/" keeps following today.
  const show = (next: DiarySearch) =>
    navigate({
      to: "/",
      search: (previous) => ({
        ...previous,
        month: next.month && next.month < currentMonth ? next.month : undefined,
        week: next.week && next.week < currentWeek ? next.week : undefined,
      }),
      replace: true,
    });

  const openJump = totals.oldestMonth
    ? () => {
        setJumpKey((key) => key + 1);
        setJumping(true);
      }
    : undefined;
  const stepWeek = (direction: 1 | -1) =>
    show({ week: stepDiaryWeek(cursorWeek, direction, currentWeek, weeks) });
  const weekSwipe = useWeekSwipe({ onStep: stepWeek, canStepForward: cursorWeek < currentWeek });

  // The month view still lays bars across its padded weeks, even with outside days hidden.
  const events = useMemo<CalendarEvent<CalendarItem>[]>(() => {
    const goalEvents = goals
      .filter((goal) => !byMonth || goal.date.startsWith(cursorMonth))
      .map((goal) => {
        const dayStart = dayKeyDate(goal.date, timeZone);
        return {
          id: `${GOAL_ID_PREFIX}${goal.id}`,
          title: goal.name,
          start: dayStart,
          end: addDays(dayStart, 1),
          allDay: true,
          color: sportTypeColor(sportTypes, goal.sportType),
          readOnly: true,
          draggable: false,
          resizable: false,
          data: goal,
        };
      });
    const activityEvents = activities
      .filter(
        (activity) => !byMonth || monthKey(new Date(activity.start), timeZone) === cursorMonth,
      )
      .map((activity) => {
        const dayStart = zonedStartOfDay(new Date(activity.start), timeZone);
        return {
          id: activity.id,
          title: activity.title,
          start: dayStart,
          end: addDays(dayStart, 1),
          allDay: true,
          color: sportTypeColor(sportTypes, activity.sportType),
          readOnly: true,
          draggable: false,
          resizable: false,
          data: activity,
        };
      });
    // Goals first, so a race day leads with the goal and then what was done.
    return [...goalEvents, ...activityEvents];
  }, [activities, goals, sportTypes, timeZone, byMonth, cursorMonth]);

  // Phones show the week at its natural height and the page scrolls: a capped card scrolled the
  // week inside itself on short iPhones, hiding Monday under the sticky day header.
  return (
    <Card className="flex min-h-80 flex-none flex-col py-0 md:h-[720px]">
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {layoutReady ? (
          <EventCalendar
            events={events}
            view={byMonth ? "month" : "days"}
            defaultView={byMonth ? "month" : "days"}
            views={DIARY_VIEWS}
            date={anchor}
            dayCount={weekRange.days}
            fixedWeeks={false}
            showOutsideDays={false}
            locale={enUS}
            timeZone={timeZone}
            i18n={{
              functions: {
                formatEventAriaLabel: (title) => title,
              },
            }}
            renderEvent={renderCalendarEvent}
            renderEventTooltip={renderCalendarEventTooltip}
            renderAgendaEvent={renderAgendaEvent}
            interactions={DISABLED_INTERACTIONS}
            onEventClick={(occurrence, event) => {
              event.preventDefault();
              if (isGoal(occurrence.event.data)) {
                void navigate({ to: "/season" });
                return;
              }
              warmActivity(queryClient, occurrence.event.id);
              const activityId = occurrence.event.id;
              void router.preloadRoute({
                to: "/activities/$activityId",
                params: { activityId },
              });
              void navigate({
                to: "/activities/$activityId",
                params: { activityId },
                search: cursor,
              });
            }}
            onPointerOver={(event) => {
              const id = (event.target as HTMLElement | null)
                ?.closest?.("[data-event-id]")
                ?.getAttribute("data-event-id");
              if (id) warmActivity(queryClient, id);
            }}
            onPointerDownCapture={(event) => {
              const id = (event.target as HTMLElement | null)
                ?.closest?.("[data-event-id]")
                ?.getAttribute("data-event-id");
              if (id) warmActivity(queryClient, id);
            }}
            weekStartsOn={MONDAY}
            eventTooltip
            className="h-full min-h-80 w-full min-w-0 flex-1"
          >
            <VisibleActivitiesPrefetch activities={activities} />
            {byMonth ? (
              <DiaryNav
                label={formatDiaryMonth(cursorMonth)}
                unit="month"
                atPresent={cursorMonth >= currentMonth}
                onStep={(direction) =>
                  void show({ month: stepDiaryMonth(cursorMonth, direction, currentMonth) })
                }
                onToday={() => void show({})}
                onJump={openJump}
              />
            ) : (
              <DiaryNav
                label={formatDiaryRange(weekRange.start, weekRange.end)}
                unit={weeks === 1 ? "week" : `${weeks} weeks`}
                atPresent={cursorWeek >= currentWeek}
                onStep={(direction) =>
                  void (isDesktop ? stepWeek(direction) : weekSwipe.slide(direction))
                }
                onToday={() => void show({})}
                onJump={openJump}
              />
            )}
            {totals.oldestMonth ? (
              <DiaryJumpPicker
                key={jumpKey}
                open={jumping}
                onOpenChange={setJumping}
                totals={totals}
                oldestMonth={totals.oldestMonth}
                cursorMonth={byMonth ? cursorMonth : monthOfWeek(cursorWeek)}
                currentMonth={currentMonth}
                currentWeek={currentWeek}
                pickWeek={!isDesktop}
                onPickMonth={(month) => {
                  setJumping(false);
                  void show(
                    byMonth ? { month } : { week: monthLandingWeek(month, weeks, currentWeek) },
                  );
                }}
                onPickWeek={(week) => {
                  setJumping(false);
                  void show({ week });
                }}
              />
            ) : null}
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              {...(isDesktop ? {} : weekSwipe.handlers)}
            >
              <div ref={weekSwipe.ref} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <EventCalendarContent
                  components={{
                    month: EventCalendarMonthView,
                    days: isDesktop ? EventCalendarMonthView : ActivityDayListView,
                  }}
                />
              </div>
            </div>
          </EventCalendar>
        ) : (
          <Skeleton className="min-h-80 flex-1 rounded-none md:min-h-[720px]" />
        )}
      </CardContent>
    </Card>
  );
}
