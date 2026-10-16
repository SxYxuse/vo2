"use client";

import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { enUS } from "date-fns/locale";
import { cn } from "cn";
import { ClipboardListIcon, HeartOffIcon, Settings2Icon, TimerIcon } from "lucide-react";

import {
  prefetchActivityDetail,
  prefetchActivityDetails,
  preloadActivityUi,
  scheduleIdle,
} from "#/lib/prefetch.ts";
import { homeQueryOptions } from "#/lib/queries.ts";
import { useDesktopMedia } from "#/components/responsive-dialog.tsx";
import {
  DEFAULT_CALENDAR_SETTINGS,
  formatSportType,
  mergeCalendarSettings,
  saveCalendarSettings,
  type CalendarSettings,
} from "#/services/calendar-settings.ts";
import {
  formatActivityClockRange,
  formatDistanceKm,
  formatDuration,
} from "#/services/activity-detail.ts";
import { isMissingHeartrate, type CalendarActivity } from "#/services/strava-sync.types.ts";
import { WeekPlanBucket } from "#/components/week-plan-bucket.tsx";
import {
  addDayKey,
  dayKey,
  openWeekBucket,
  suggestWeek,
  weekStartKey,
  type PlannedSession,
  type TrainingPlan,
} from "#/services/training-plan.ts";
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
import {
  EventCalendarNav,
  EventCalendarToolbar,
} from "@/components/reui/event-calendar/event-calendar-nav";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DISABLED_INTERACTIONS = { drag: false, resize: false, selectSlot: false } as const;

const ActivityDetailDialog = lazy(() =>
  import("#/components/activity-detail-dialog.tsx").then((mod) => ({
    default: mod.ActivityDetailDialog,
  })),
);

const PlannedSessionDialog = lazy(() =>
  import("#/components/planned-session-dialog.tsx").then((mod) => ({
    default: mod.PlannedSessionDialog,
  })),
);

function formatTrainingHmm(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

function PeriodTrainingTotal({
  activities,
  sportTypes,
}: {
  activities: CalendarActivity[];
  sportTypes: CalendarSettings["sportTypes"];
}) {
  const { activeRange } = useEventCalendarNavigation();
  const totalSeconds = useMemo(() => {
    const startMs = activeRange.start.getTime();
    const endMs = activeRange.end.getTime();
    let total = 0;
    for (const activity of activities) {
      if (sportTypes[activity.sportType]?.visible === false) continue;
      const startedAt = new Date(activity.start).getTime();
      if (startedAt >= startMs && startedAt < endMs) {
        total += activity.movingTime;
      }
    }
    return total;
  }, [activities, sportTypes, activeRange.start, activeRange.end]);

  const label = formatTrainingHmm(totalSeconds);
  return (
    <Badge variant="outline" aria-label={`Total training time ${label}`}>
      <TimerIcon data-icon="inline-start" />
      <span className="font-mono tabular-nums">{label}</span>
    </Badge>
  );
}

function MissingHeartrateMark() {
  return (
    <HeartOffIcon
      data-slot="activity-missing-heartrate"
      className="text-warning size-2.5 shrink-0"
      aria-hidden
    />
  );
}

function warmActivity(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
) {
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

const MOBILE_CALENDAR_VIEWS: CalendarView[] = ["week", "agenda", "month", "day"];
const DESKTOP_CALENDAR_VIEWS: CalendarView[] = ["month", "week", "day", "days", "agenda"];

/** Vertical week list: ReUI agenda rows plus rest days, for phone widths. */
function ActivityWeekListView() {
  const instance = useEventCalendar();
  const settings = useEventCalendarSettings();
  const viewConfig = useEventCalendarViewConfig();
  const visibleRange = useEventCalendarSelector<unknown, EventCalendarDateRange>(
    (state) => state.visibleRange,
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

  const index = instance.internals.getIndex();
  const native = viewConfig.scrollbars === "native";

  const body = (
    <div className="flex flex-col [&>*:last-child>*:last-child]:border-b-0">
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
            role="group"
            aria-label={`${weekday}, ${dayDate}`}
            data-today={today || undefined}
          >
            <div
              className={cn(
                "bg-muted/60 sticky top-0 z-10 flex items-baseline justify-between gap-4 border-b px-4 py-2",
                !native && "me-2.5",
              )}
            >
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
          <div className="h-full overflow-y-auto">{body}</div>
        ) : (
          <ScrollArea className="h-full">{body}</ScrollArea>
        )}
      </div>
    </EventCalendarViewContext.Provider>
  );
}

function SettingsSwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  );
}

function SettingsSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number | string;
  options: Array<{ value: number | string; label: string }>;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = options.find((option) => String(option.value) === String(value));
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={String(value)}
        onValueChange={(next) => {
          if (next == null) return;
          onValueChange(String(next));
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue>{selected?.label ?? String(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={String(option.value)} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

function CalendarTimeGridFields({
  settings,
  patch,
}: {
  settings: CalendarSettings;
  patch: (partial: Partial<CalendarSettings>) => void;
}) {
  return (
    <TabsContent value="time">
      <FieldGroup className="gap-3">
        <SettingsSelect
          id="ec-set-day-start"
          label="Day starts"
          value={settings.dayStartHour}
          options={[
            { value: 0, label: "00:00" },
            { value: 6, label: "06:00" },
            { value: 8, label: "08:00" },
          ]}
          onValueChange={(dayStartHour) => patch({ dayStartHour: Number(dayStartHour) })}
        />
        <SettingsSelect
          id="ec-set-day-end"
          label="Day ends"
          value={settings.dayEndHour}
          options={[
            { value: 18, label: "18:00" },
            { value: 20, label: "20:00" },
            { value: 24, label: "24:00" },
          ]}
          onValueChange={(dayEndHour) => patch({ dayEndHour: Number(dayEndHour) })}
        />
        <SettingsSelect
          id="ec-set-interval"
          label="Grid interval"
          value={settings.interval}
          options={[
            { value: 30, label: "30 min" },
            { value: 60, label: "60 min" },
          ]}
          onValueChange={(interval) => patch({ interval: Number(interval) })}
        />
      </FieldGroup>
    </TabsContent>
  );
}

function CalendarSettingsForm({
  settings,
  settingsTab,
  timeGrid,
  saveError,
  onSettingsTabChange,
  patch,
  onReset,
}: {
  settings: CalendarSettings;
  settingsTab: string;
  timeGrid?: ReactNode;
  saveError: string | null;
  onSettingsTabChange: (tab: string) => void;
  patch: (partial: Partial<CalendarSettings>) => void;
  onReset: () => void;
}) {
  return (
    <>
      <Tabs
        value={settingsTab}
        onValueChange={(next) => {
          if (next == null) return;
          onSettingsTabChange(String(next));
        }}
      >
        <TabsList className="h-auto w-full flex-wrap">
          <TabsTrigger value="view">View</TabsTrigger>
          {timeGrid ? <TabsTrigger value="time">Time grid</TabsTrigger> : null}
          <TabsTrigger value="region">Region</TabsTrigger>
        </TabsList>
        <TabsContent value="view">
          <FieldGroup className="gap-3">
            <SettingsSwitch
              id="ec-set-weekends"
              label="Weekends"
              checked={settings.viewSettings.weekends ?? true}
              onCheckedChange={(weekends) =>
                patch({ viewSettings: { ...settings.viewSettings, weekends } })
              }
            />
            <SettingsSwitch
              id="ec-set-week-numbers"
              label="Week numbers"
              checked={settings.viewSettings.weekNumbers ?? false}
              onCheckedChange={(weekNumbers) =>
                patch({ viewSettings: { ...settings.viewSettings, weekNumbers } })
              }
            />
            <SettingsSwitch
              id="ec-set-now"
              label="Now indicator"
              checked={settings.viewSettings.nowIndicator ?? true}
              onCheckedChange={(nowIndicator) =>
                patch({ viewSettings: { ...settings.viewSettings, nowIndicator } })
              }
            />
            <SettingsSwitch
              id="ec-set-off-days"
              label="Mark off days"
              checked={settings.viewSettings.offDays ?? false}
              onCheckedChange={(offDays) =>
                patch({ viewSettings: { ...settings.viewSettings, offDays } })
              }
            />
            <SettingsSelect
              id="ec-set-week-start"
              label="Week starts"
              value={settings.weekStartsOn}
              options={[
                { value: 0, label: "Sunday" },
                { value: 1, label: "Monday" },
              ]}
              onValueChange={(weekStartsOn) =>
                patch({ weekStartsOn: Number(weekStartsOn) as 0 | 1 })
              }
            />
          </FieldGroup>
        </TabsContent>
        {timeGrid}
        <TabsContent value="region">
          <FieldGroup className="gap-3">
            <SettingsSelect
              id="ec-set-language"
              label="Language"
              value="en"
              options={[{ value: "en", label: "English" }]}
              onValueChange={() => undefined}
              disabled
            />
            <SettingsSelect
              id="ec-set-timezone"
              label="Time zone"
              value="browser"
              options={[{ value: "browser", label: "Browser" }]}
              onValueChange={() => undefined}
              disabled
            />
            <FieldDescription>Language is English. Time zone follows the browser.</FieldDescription>
          </FieldGroup>
        </TabsContent>
      </Tabs>
      {saveError ? <p className="text-destructive text-xs">{saveError}</p> : null}
      <Button variant="outline" size="sm" className="w-full" onClick={onReset}>
        Reset to defaults
      </Button>
    </>
  );
}

type ActivityCalendarProps = {
  activities: CalendarActivity[];
  plannedSessions: PlannedSession[];
  training: TrainingPlan | null;
  initialSettings: CalendarSettings;
  persist: boolean;
  selectedActivityId: string | null;
  onSelectActivity: (id: string | null) => void;
};

export function ActivityCalendar({
  activities,
  plannedSessions,
  training,
  initialSettings,
  persist,
  selectedActivityId,
  onSelectActivity,
}: ActivityCalendarProps) {
  const sportTypeNames = useMemo(
    () => activities.map((activity) => activity.sportType),
    [activities],
  );
  const [settings, setSettings] = useState<CalendarSettings>(() =>
    mergeCalendarSettings(initialSettings, sportTypeNames),
  );
  const isDesktopMedia = useDesktopMedia();
  const layoutReady = isDesktopMedia !== null;
  const isDesktop = isDesktopMedia === true;
  const [view, setView] = useState<CalendarView | null>(null);
  const activeView = view ?? (isDesktop ? "month" : "week");
  const [settingsTab, setSettingsTab] = useState("view");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const skipSave = useRef(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    preloadActivityUi();
    return scheduleIdle(() => {
      prefetchActivityDetails(
        queryClient,
        activities.map((activity) => activity.id),
      );
    });
  }, [activities, queryClient]);
  const saveSettings = useMutation({
    mutationFn: (next: CalendarSettings) => saveCalendarSettings({ data: next }),
    onSuccess: (saved) => {
      setSaveError(null);
      queryClient.setQueryData(homeQueryOptions.queryKey, (current) =>
        current ? { ...current, settings: saved } : current,
      );
    },
    onError: (caught) => {
      setSaveError(caught instanceof Error ? caught.message : "Could not save settings");
    },
  });
  const isTimeGridView =
    activeView === "day" || activeView === "days" || (activeView === "week" && isDesktop);

  useEffect(() => {
    setSettings((current) => {
      const next = mergeCalendarSettings(
        {
          ...current,
          sportTypes: initialSettings.sportTypes,
          sportGroupShares: initialSettings.sportGroupShares,
        },
        sportTypeNames,
      );
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  }, [initialSettings.sportGroupShares, initialSettings.sportTypes, sportTypeNames]);

  useEffect(() => {
    if (!isTimeGridView && settingsTab === "time") {
      setSettingsTab("view");
    }
    if (settingsTab === "types") setSettingsTab("view");
  }, [isTimeGridView, settingsTab]);

  useEffect(() => {
    if (!persist) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      saveSettings.mutate(settings);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [persist, settings]);

  const patch = (partial: Partial<CalendarSettings>) =>
    setSettings((current) => ({ ...current, ...partial }));

  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const planWeek = useMutation({
    mutationFn: () => suggestWeek({ data: { timeZone } }),
    onSuccess: (sessions) => {
      setPlanError(null);
      queryClient.setQueryData(homeQueryOptions.queryKey, (current) =>
        current ? { ...current, plannedSessions: sessions } : current,
      );
    },
    onError: (caught) => {
      setPlanError(caught instanceof Error ? caught.message : "Could not suggest this week");
    },
  });

  const weekStart = useMemo(() => weekStartKey(new Date(), timeZone), [timeZone]);
  const today = useMemo(() => dayKey(new Date(), timeZone), [timeZone]);
  const loggedMinutes = useMemo(() => {
    const weekEnd = addDayKey(weekStart, 6);
    return activities.reduce((sum, activity) => {
      const date = dayKey(new Date(activity.start), timeZone);
      if (date < weekStart || date > weekEnd) return sum;
      return sum + Math.round(activity.movingTime / 60);
    }, 0);
  }, [activities, timeZone, weekStart]);
  const remainingCount = useMemo(
    () => openWeekBucket(plannedSessions, weekStart).length,
    [plannedSessions, weekStart],
  );

  const events = useMemo<CalendarEvent<CalendarActivity>[]>(() => {
    return activities
      .filter((activity) => settings.sportTypes[activity.sportType]?.visible !== false)
      .map((activity) => {
        const dayStart = zonedStartOfDay(new Date(activity.start), timeZone);
        return {
          id: activity.id,
          title: activity.title,
          start: dayStart,
          end: addDays(dayStart, 1),
          allDay: true,
          color: settings.sportTypes[activity.sportType]?.color ?? "var(--color-ds-gray-700)",
          readOnly: true,
          draggable: false,
          resizable: false,
          data: activity,
        };
      });
  }, [activities, settings.sportTypes, timeZone]);

  const resetSettings = useCallback(() => {
    setSettings((current) =>
      mergeCalendarSettings(
        {
          ...DEFAULT_CALENDAR_SETTINGS,
          sportTypes: current.sportTypes,
          sportGroupShares: current.sportGroupShares,
        },
        sportTypeNames,
      ),
    );
  }, [sportTypeNames]);

  const settingsForm = (
    <CalendarSettingsForm
      settings={settings}
      settingsTab={settingsTab}
      timeGrid={
        isTimeGridView ? <CalendarTimeGridFields settings={settings} patch={patch} /> : null
      }
      saveError={saveError}
      onSettingsTabChange={setSettingsTab}
      patch={patch}
      onReset={resetSettings}
    />
  );

  return (
    <Card className="flex min-h-80 flex-1 flex-col py-0 md:h-[720px] md:flex-none">
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {layoutReady ? (
          <EventCalendar
            events={events}
            view={activeView}
            views={isDesktop ? DESKTOP_CALENDAR_VIEWS : MOBILE_CALENDAR_VIEWS}
            onViewChange={(next) => startTransition(() => setView(next))}
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
            viewSettings={settings.viewSettings}
            onViewSettingsChange={(viewSettings) =>
              patch({
                viewSettings: {
                  weekends: viewSettings.weekends ?? true,
                  weekNumbers: viewSettings.weekNumbers ?? false,
                  nowIndicator: viewSettings.nowIndicator ?? true,
                  offDays: viewSettings.offDays ?? false,
                },
              })
            }
            interactions={DISABLED_INTERACTIONS}
            onEventClick={(occurrence, event) => {
              event.preventDefault();
              warmActivity(queryClient, occurrence.event.id);
              onSelectActivity(occurrence.event.id);
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
            weekStartsOn={settings.weekStartsOn}
            dayStartHour={settings.dayStartHour}
            dayEndHour={settings.dayEndHour}
            interval={settings.interval}
            snapDuration={settings.snapDuration}
            eventTooltip
            offDays
            className="h-full min-h-80 w-full min-w-0 flex-1"
          >
            <VisibleActivitiesPrefetch activities={activities} />
            <div className="flex flex-wrap items-center gap-2 px-1 sm:pe-2">
              <EventCalendarNav className="min-w-0 flex-1" />
              <div className="flex shrink-0 items-center gap-2">
                {training ? (
                  <Sheet>
                    <SheetTrigger
                      render={<Button variant="outline" size="sm" aria-label="This week" />}
                    >
                      <ClipboardListIcon data-icon="inline-start" />
                      <span className="hidden sm:inline">This week</span>
                      {remainingCount ? <Badge variant="warning">{remainingCount}</Badge> : null}
                    </SheetTrigger>
                    <SheetContent
                      side={isDesktop ? "right" : "bottom"}
                      className={
                        isDesktop
                          ? "sm:max-w-md"
                          : "flex max-h-[85dvh] flex-col overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))]"
                      }
                    >
                      <WeekPlanBucket
                        sessions={plannedSessions}
                        weekStart={weekStart}
                        today={today}
                        plan={training}
                        loggedMinutes={loggedMinutes}
                        pending={planWeek.isPending}
                        error={planError}
                        onFillWeek={() => planWeek.mutate()}
                        onSelectSession={setSelectedPlanId}
                      />
                    </SheetContent>
                  </Sheet>
                ) : null}
                <PeriodTrainingTotal activities={activities} sportTypes={settings.sportTypes} />
                <EventCalendarToolbar>
                  {isDesktop ? (
                    <Popover>
                      <PopoverTrigger
                        render={<Button variant="outline" size="sm" aria-label="Settings" />}
                      >
                        <Settings2Icon data-icon="inline-start" />
                        <span className="hidden sm:inline">Settings</span>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden"
                      >
                        <PopoverTitle>Calendar settings</PopoverTitle>
                        {settingsForm}
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Sheet>
                      <SheetTrigger
                        render={<Button variant="outline" size="sm" aria-label="Settings" />}
                      >
                        <Settings2Icon data-icon="inline-start" />
                      </SheetTrigger>
                      <SheetContent
                        side="bottom"
                        className="max-h-[85dvh] overflow-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
                      >
                        <SheetHeader>
                          <SheetTitle>Calendar settings</SheetTitle>
                        </SheetHeader>
                        <div className="flex flex-col gap-3 px-6 pb-2">{settingsForm}</div>
                      </SheetContent>
                    </Sheet>
                  )}
                </EventCalendarToolbar>
              </div>
            </div>
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                isTimeGridView && "overflow-x-auto",
              )}
            >
              <EventCalendarContent
                className={cn(isTimeGridView && "min-w-[40rem]")}
                components={!isDesktop ? { week: ActivityWeekListView } : undefined}
              />
            </div>
          </EventCalendar>
        ) : (
          <Skeleton className="min-h-80 flex-1 rounded-none md:min-h-[720px]" />
        )}
        <Suspense fallback={null}>
          <ActivityDetailDialog
            activityId={selectedActivityId}
            preview={activities.find((activity) => activity.id === selectedActivityId) ?? null}
            color={events.find((event) => event.id === selectedActivityId)?.color}
            onOpenChange={(open) => {
              if (!open) onSelectActivity(null);
            }}
          />
        </Suspense>
        <Suspense fallback={null}>
          <PlannedSessionDialog
            session={plannedSessions.find((session) => session.id === selectedPlanId) ?? null}
            onOpenChange={(open) => {
              if (!open) setSelectedPlanId(null);
            }}
          />
        </Suspense>
      </CardContent>
    </Card>
  );
}
