"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { enUS } from "date-fns/locale";
import { cn } from "cn";
import { ClipboardListIcon, HeartOffIcon, Settings2Icon, TimerIcon } from "lucide-react";

import { activityDetailQueryOptions, homeQueryOptions } from "#/lib/queries.ts";
import {
  DEFAULT_CALENDAR_SETTINGS,
  mergeCalendarSettings,
  saveCalendarSettings,
  type CalendarSettings,
} from "#/services/calendar-settings.ts";
import { formatActivityClockRange } from "#/services/activity-detail.ts";
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
  useEventCalendarNavigation,
} from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import {
  EventCalendarNav,
  EventCalendarToolbar,
} from "@/components/reui/event-calendar/event-calendar-nav";
import { zonedStartOfDay } from "@/components/reui/event-calendar/event-calendar-lib";
import type {
  CalendarEvent,
  CalendarView,
} from "@/components/reui/event-calendar/event-calendar-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
  const [view, setView] = useState<CalendarView>("month");
  const [settingsTab, setSettingsTab] = useState("view");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const skipSave = useRef(true);
  const queryClient = useQueryClient();
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
  const isTimeGridView = view !== "month" && view !== "agenda";

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

  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <EventCalendar
          events={events}
          defaultView="month"
          onViewChange={setView}
          locale={enUS}
          timeZone={timeZone}
          i18n={{
            functions: {
              formatEventAriaLabel: (title) => title,
            },
          }}
          renderEvent={({ occurrence }) => {
            const activity = occurrence.event.data as CalendarActivity | undefined;
            return (
              <span
                className="contents"
                onPointerEnter={() => {
                  void queryClient.prefetchQuery(activityDetailQueryOptions(occurrence.event.id));
                }}
              >
                <span
                  aria-hidden
                  data-slot="event-calendar-event-dot"
                  className="-me-0.5 size-1.5 shrink-0 rounded-full bg-(--ec-event-color)"
                />
                <span className="truncate font-medium">{occurrence.event.title}</span>
                {activity && isMissingHeartrate(activity) ? <MissingHeartrateMark /> : null}
              </span>
            );
          }}
          renderEventTooltip={({ occurrence }) => {
            const activity = occurrence.event.data as CalendarActivity | undefined;
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
          }}
          renderAgendaEvent={({ occurrence }) => {
            const activity = occurrence.event.data as CalendarActivity | undefined;
            return (
              <>
                <span
                  aria-hidden
                  data-slot="event-calendar-agenda-dot"
                  className="size-2 shrink-0 rounded-full bg-(--ec-event-color)"
                />
                <span className="truncate text-sm">{occurrence.event.title}</span>
                {activity && isMissingHeartrate(activity) ? <MissingHeartrateMark /> : null}
              </>
            );
          }}
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
            void queryClient.prefetchQuery(activityDetailQueryOptions(occurrence.event.id));
            onSelectActivity(occurrence.event.id);
          }}
          weekStartsOn={settings.weekStartsOn}
          dayStartHour={settings.dayStartHour}
          dayEndHour={settings.dayEndHour}
          interval={settings.interval}
          snapDuration={settings.snapDuration}
          eventTooltip
          showDayAddButton={false}
          offDays
          className="h-[min(40rem,calc(100dvh-12rem))] w-full min-w-0 md:h-[720px]"
        >
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
                  <SheetContent side="right" className="sm:max-w-md">
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
                    <Tabs
                      value={settingsTab}
                      onValueChange={(next) => {
                        if (next == null) return;
                        setSettingsTab(String(next));
                      }}
                    >
                      <TabsList className="h-auto w-full flex-wrap">
                        <TabsTrigger value="view">View</TabsTrigger>
                        {isTimeGridView ? <TabsTrigger value="time">Time grid</TabsTrigger> : null}
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
                            onValueChange={(dayStartHour) =>
                              patch({ dayStartHour: Number(dayStartHour) })
                            }
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
                            onValueChange={(dayEndHour) =>
                              patch({ dayEndHour: Number(dayEndHour) })
                            }
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
                          <FieldDescription>
                            Language is English. Time zone follows the browser.
                          </FieldDescription>
                        </FieldGroup>
                      </TabsContent>
                    </Tabs>
                    {saveError ? <p className="text-destructive text-xs">{saveError}</p> : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        setSettings(
                          mergeCalendarSettings(
                            {
                              ...DEFAULT_CALENDAR_SETTINGS,
                              sportTypes: settings.sportTypes,
                              sportGroupShares: settings.sportGroupShares,
                            },
                            sportTypeNames,
                          ),
                        )
                      }
                    >
                      Reset to defaults
                    </Button>
                  </PopoverContent>
                </Popover>
              </EventCalendarToolbar>
            </div>
          </div>
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              isTimeGridView && "overflow-x-auto",
            )}
          >
            <EventCalendarContent className={cn(isTimeGridView && "min-w-[40rem]")} />
          </div>
        </EventCalendar>
        {selectedActivityId ? (
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
        ) : null}
        {selectedPlanId ? (
          <Suspense fallback={null}>
            <PlannedSessionDialog
              session={plannedSessions.find((session) => session.id === selectedPlanId) ?? null}
              onOpenChange={(open) => {
                if (!open) setSelectedPlanId(null);
              }}
            />
          </Suspense>
        ) : null}
      </CardContent>
    </Card>
  );
}
