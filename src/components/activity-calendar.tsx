"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import { enUS } from "date-fns/locale";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon, HeartOffIcon } from "lucide-react";

import { prefetchActivityDetail, prefetchActivityDetails, scheduleIdle } from "@/lib/prefetch.ts";
import { useDesktopMedia } from "@/components/responsive-dialog.tsx";
import {
  formatSportType,
  mergeCalendarSettings,
  type CalendarSettings,
} from "@/services/calendar-settings.ts";
import {
  formatActivityClockRange,
  formatDistanceKm,
  formatDuration,
} from "@/services/activity-detail.ts";
import { isMissingHeartrate, type CalendarActivity } from "@/services/strava-sync.types.ts";
import {
  diaryWindow,
  formatDiaryMonth,
  formatDiaryRange,
  lastWeekOfMonth,
  monthKey,
  monthOfWeek,
  resolveDiaryCursorMonth,
  resolveDiaryCursorWeek,
  stepDiaryMonth,
  stepDiaryWeek,
  type DiarySearch,
} from "@/services/diary-window.ts";
import { weekStartKey } from "@/services/training-plan.types.ts";
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
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
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

function warmActivity(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  prefetchActivityDetail(queryClient, id);
}

function CalendarEventChip({
  occurrence,
}: {
  occurrence: EventCalendarRenderEventProps<CalendarActivity>["occurrence"];
}) {
  const queryClient = useQueryClient();
  const activity = occurrence.event.data;
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

function renderCalendarEvent({ occurrence }: EventCalendarRenderEventProps<CalendarActivity>) {
  return <CalendarEventChip occurrence={occurrence} />;
}

function renderCalendarEventTooltip({
  occurrence,
}: {
  occurrence: EventCalendarRenderEventProps<CalendarActivity>["occurrence"];
}) {
  const activity = occurrence.event.data;
  if (!activity) return occurrence.event.title;
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
  occurrence: EventCalendarRenderEventProps<CalendarActivity>["occurrence"];
}) {
  const queryClient = useQueryClient();
  const activity = occurrence.event.data;
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

function renderAgendaEvent({ occurrence }: EventCalendarRenderEventProps<CalendarActivity>) {
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

  const body = (
    <div className="isolate flex flex-col [&>*:last-child>*:last-child]:border-b-0">
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
              <span className={cn("font-semibold", today && "text-primary")}>{weekday}</span>
              <span className="text-muted-foreground font-medium tabular-nums">{dayDate}</span>
            </div>
            {items.length === 0 ? (
              <ItemGroup className="gap-0">
                <Item size="xs" className="rounded-none border-b px-4 py-2">
                  <ItemContent>
                    <ItemTitle className="text-muted-foreground font-normal">Rest</ItemTitle>
                  </ItemContent>
                </Item>
              </ItemGroup>
            ) : (
              items.map((segment) => (
                <EventCalendarEvent
                  key={segment.occurrence.key}
                  segment={segment}
                  className="hover:bg-accent/40 gap-3 rounded-none border-b px-4 py-2.5"
                />
              ))
            )}
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
}: {
  label: string;
  unit: string;
  atPresent: boolean;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 py-2">
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
      <div aria-live="polite" className="ms-3 min-w-0 truncate text-sm font-semibold">
        {label}
      </div>
    </div>
  );
}

type ActivityCalendarProps = {
  activities: CalendarActivity[];
  initialSettings: CalendarSettings;
  diary: DiarySearch;
};

export function ActivityCalendar({ activities, initialSettings, diary }: ActivityCalendarProps) {
  const sportTypes = useMemo(
    () =>
      mergeCalendarSettings(
        initialSettings,
        activities.map((activity) => activity.sportType),
      ).sportTypes,
    [activities, initialSettings],
  );
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
  const anchor = useMemo(
    () => dayKeyDate(byMonth ? `${cursorMonth}-01` : weekRange.start, timeZone),
    [byMonth, cursorMonth, weekRange.start, timeZone],
  );
  const cursor: DiarySearch = byMonth ? { month: cursorMonth } : { week: cursorWeek };
  // The present stays out of the URL so a bare "/" keeps following today.
  const show = (next: DiarySearch) =>
    void navigate({
      to: "/",
      search: (previous) => ({
        ...previous,
        month: next.month && next.month < currentMonth ? next.month : undefined,
        week: next.week && next.week < currentWeek ? next.week : undefined,
      }),
      replace: true,
    });

  useEffect(() => {
    return scheduleIdle(() => {
      prefetchActivityDetails(
        queryClient,
        activities.map((activity) => activity.id),
      );
    });
  }, [activities, queryClient]);

  // The month view still lays bars across its padded weeks, even with outside days hidden.
  const events = useMemo<CalendarEvent<CalendarActivity>[]>(() => {
    return activities
      .filter(
        (activity) =>
          sportTypes[activity.sportType]?.visible !== false &&
          (!byMonth || monthKey(new Date(activity.start), timeZone) === cursorMonth),
      )
      .map((activity) => {
        const dayStart = zonedStartOfDay(new Date(activity.start), timeZone);
        return {
          id: activity.id,
          title: activity.title,
          start: dayStart,
          end: addDays(dayStart, 1),
          allDay: true,
          color: sportTypes[activity.sportType]?.color ?? "var(--color-ds-gray-700)",
          readOnly: true,
          draggable: false,
          resizable: false,
          data: activity,
        };
      });
  }, [activities, sportTypes, timeZone, byMonth, cursorMonth]);

  return (
    <Card className="flex h-[calc(100dvh-7.5rem)] min-h-80 flex-none flex-col py-0 md:h-[720px]">
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
                  show({ month: stepDiaryMonth(cursorMonth, direction, currentMonth) })
                }
                onToday={() => show({})}
              />
            ) : (
              <DiaryNav
                label={formatDiaryRange(weekRange.start, weekRange.end)}
                unit={weeks === 1 ? "week" : `${weeks} weeks`}
                atPresent={cursorWeek >= currentWeek}
                onStep={(direction) =>
                  show({ week: stepDiaryWeek(cursorWeek, direction, currentWeek, weeks) })
                }
                onToday={() => show({})}
              />
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <EventCalendarContent
                components={{
                  month: EventCalendarMonthView,
                  days: isDesktop ? EventCalendarMonthView : ActivityDayListView,
                }}
              />
            </div>
          </EventCalendar>
        ) : (
          <Skeleton className="min-h-80 flex-1 rounded-none md:min-h-[720px]" />
        )}
      </CardContent>
    </Card>
  );
}
