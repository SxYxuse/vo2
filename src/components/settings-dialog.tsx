"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, RefreshCwIcon, TargetIcon, UserIcon } from "lucide-react";
import { Controller, useForm, useWatch, type FieldErrors, type FieldPath } from "react-hook-form";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  assessmentsQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
  settingsSnapshotQueryOptions,
} from "@/lib/queries.ts";
import {
  profileFromForm,
  settingsFormDefaults,
  settingsFormSchema,
  trainingFromForm,
  type SettingsFormInput,
  type SettingsFormValues,
} from "@/lib/settings-form.ts";
import { saveAppSettings } from "@/services/app-settings.ts";
import {
  ACTIVITY_COLOR_OPTIONS,
  formatSportType,
  heartRateCollectorLabel,
  sortSportTypeKeys,
  sportOffersPower,
  type CalendarSettings,
} from "@/services/calendar-settings.ts";
import { DEFAULT_SPORT_GROUP_SHARES, SPORT_GROUPS } from "@/services/sport-groups.ts";
import { recentAverageWeeklyHours } from "@/services/training-plan.ts";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import {
  ProfileFields,
  TrainingPaceFields,
  TrainingStyleFields,
  TrainingDoubleDaysField,
  TrainingWeekFields,
} from "@/components/settings-fields.tsx";
import { SettingsSyncSection } from "@/components/settings-sync-section.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

type SettingsSection = "profile" | "sports" | "training" | "sync";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "training", label: "Training", icon: TargetIcon },
  { id: "sports", label: "Sports", icon: ActivityIcon },
  { id: "sync", label: "Sync", icon: RefreshCwIcon },
];

const PROFILE_ERROR_KEYS = ["birthDate", "weightKg", "heightCm"] as const;
const SPORTS_ERROR_KEYS = ["sportTypes", "sportGroupShares"] as const;

function colorLabel(value: string) {
  return ACTIVITY_COLOR_OPTIONS.find((option) => option.value === value)?.label ?? "Custom";
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function sportColor(value: unknown, fallback?: string) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return ACTIVITY_COLOR_OPTIONS[0]?.value ?? "";
}

function sectionForErrors(errors: FieldErrors<SettingsFormInput>): SettingsSection {
  if (PROFILE_ERROR_KEYS.some((key) => errors[key])) return "profile";
  if (SPORTS_ERROR_KEYS.some((key) => errors[key])) return "sports";
  return "training";
}

export function SettingsDialog({
  open,
  onOpenChange,
  userName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery(settingsSnapshotQueryOptions);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const avgHours = useMemo(
    () => (data ? recentAverageWeeklyHours(data.fitnessLoads, timeZone) : 0),
    [data?.fitnessLoads, timeZone],
  );
  const [section, setSection] = useState<SettingsSection>("profile");
  const [saveError, setSaveError] = useState<string | null>(null);
  const emptyDefaults = useMemo(
    () =>
      settingsFormDefaults({
        profile: null,
        training: null,
        sportTypes: {},
        sportGroupShares: DEFAULT_SPORT_GROUP_SHARES,
        avgHours: 5,
        timeZone,
      }),
    [timeZone],
  );
  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: emptyDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const sportTypes = (useWatch({ control: form.control, name: "sportTypes" }) ??
    {}) as CalendarSettings["sportTypes"];

  useEffect(() => {
    if (open) setSection("profile");
  }, [open]);

  useEffect(() => {
    if (!open || !data) return;
    setSaveError(null);
    form.reset(
      settingsFormDefaults({
        profile: data.profile,
        training: data.training,
        sportTypes: data.settings.sportTypes,
        sportGroupShares: data.settings.sportGroupShares,
        avgHours: recentAverageWeeklyHours(data.fitnessLoads, timeZone),
        timeZone,
      }),
    );
  }, [open, data?.profile, data?.training, data?.settings, data?.fitnessLoads, timeZone, form]);

  const sortedSports = useMemo(() => sortSportTypeKeys(sportTypes), [sportTypes]);
  const shareableGroups = useMemo(
    () =>
      SPORT_GROUPS.map((group) => ({
        ...group,
        members: group.members.filter((member) => sportTypes[member]),
      })).filter((group) => group.members.length >= 2),
    [sportTypes],
  );

  const save = useMutation({
    mutationFn: saveAppSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(homeQueryOptions.queryKey, (current) =>
        current ? { ...current, settings: saved.settings, training: saved.training } : current,
      );
      queryClient.setQueryData(settingsSnapshotQueryOptions.queryKey, (current) =>
        current
          ? {
              ...current,
              profile: saved.profile,
              settings: saved.settings,
              training: saved.training,
            }
          : current,
      );
      queryClient.setQueryData(appShellQueryOptions.queryKey, (current) =>
        current ? { ...current, training: saved.training } : current,
      );
      void queryClient.invalidateQueries({ queryKey: appShellQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: heartRateQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: activityMapQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: assessmentsQueryOptions.queryKey });
      setSaveError(null);
      onOpenChange(false);
    },
    onError: (caught) => {
      setSaveError(caught instanceof Error ? caught.message : "Could not save settings");
    },
  });

  function onSubmit(values: SettingsFormValues) {
    save.mutate({
      data: {
        profile: profileFromForm(values),
        sportTypes: values.sportTypes,
        sportGroupShares: values.sportGroupShares,
        training: trainingFromForm(values),
      },
    });
  }

  function onInvalid(errors: FieldErrors<SettingsFormInput>) {
    setSection(sectionForErrors(errors));
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        showCloseButton
        className="flex h-[min(40rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 [--drawer-content-height:min(40rem,calc(100dvh-2rem))] sm:max-w-3xl"
      >
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        >
          <ResponsiveDialogHeader className="border-b px-4 py-3 group-data-[swipe-axis=y]/drawer-popup:text-left">
            <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Profile, training goal, sport types, and the Strava copy of activities and streams.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <nav className="flex gap-1 overflow-x-auto border-b p-2 md:w-48 md:shrink-0 md:flex-col md:border-r md:border-b-0">
              {SECTIONS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={section === item.id ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-start"
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <item.icon data-icon="inline-start" />
                  {item.label}
                </Button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-4 p-4">
                  {!data ? (
                    <div className="flex justify-center py-12">
                      <Spinner />
                    </div>
                  ) : section === "profile" ? (
                    <ProfileFields idPrefix="settings" userName={userName} control={form.control} />
                  ) : section === "training" ? (
                    <FieldGroup>
                      <TrainingPaceFields idPrefix="settings" control={form.control} />
                      <FieldSeparator />
                      <TrainingWeekFields
                        idPrefix="settings"
                        control={form.control}
                        setValue={form.setValue}
                        avgHours={avgHours}
                      />
                      <TrainingDoubleDaysField idPrefix="settings" control={form.control} />
                      <TrainingStyleFields
                        idPrefix="settings"
                        control={form.control}
                        onOpenSports={() => setSection("sports")}
                      />
                    </FieldGroup>
                  ) : section === "sync" ? (
                    <SettingsSyncSection enabled={open} />
                  ) : sortedSports.length === 0 ? (
                    <Empty className="min-h-48 border">
                      <EmptyHeader>
                        <EmptyTitle>No activity types yet</EmptyTitle>
                        <EmptyDescription>
                          Sync from Strava to choose which sports appear in the calendar, map, and
                          heart rate.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <FieldGroup className="gap-3">
                      {shareableGroups.length ? (
                        <>
                          <FieldSet>
                            <FieldLegend>Shared data</FieldLegend>
                            <FieldDescription>
                              When on, types in the group share one max heart rate and zone set — a
                              peak on a gravel ride also sets indoor and road ride zones.
                            </FieldDescription>
                            {shareableGroups.map((group) => {
                              const inputId = `app-group-${group.id}`;
                              const name =
                                `sportGroupShares.${group.id}` as FieldPath<SettingsFormInput>;
                              return (
                                <Controller
                                  key={group.id}
                                  name={name}
                                  control={form.control}
                                  render={({ field }) => (
                                    <Field orientation="horizontal">
                                      <Switch
                                        id={inputId}
                                        checked={Boolean(field.value)}
                                        onCheckedChange={field.onChange}
                                      />
                                      <FieldContent>
                                        <FieldLabel htmlFor={inputId} className="font-normal">
                                          {group.label}
                                        </FieldLabel>
                                        <FieldDescription>
                                          {group.members.map(formatSportType).join(", ")}
                                        </FieldDescription>
                                      </FieldContent>
                                    </Field>
                                  )}
                                />
                              );
                            })}
                          </FieldSet>
                          <FieldSeparator />
                        </>
                      ) : null}
                      <FieldDescription>
                        These types and colors apply to the calendar, map, heart rate, and other
                        views. Mark the hardware you actually use — Ride with an HR belt and
                        power-meter pedals, gravel with a belt only, running with an HR watch — so
                        structured sessions can prescribe watts, heart rate, or RPE.
                      </FieldDescription>
                      {sortedSports.map((sportType) => {
                        const typeSettings = sportTypes[sportType];
                        const inputId = `app-type-${sportType}`;
                        const heartId = `${inputId}-hr`;
                        const powerId = `${inputId}-power`;
                        const offersPower = sportOffersPower(sportType);
                        return (
                          <FieldGroup key={sportType} className="rounded-lg border p-3">
                            <Field orientation="horizontal">
                              <Controller
                                name={
                                  `sportTypes.${sportType}.visible` as FieldPath<SettingsFormInput>
                                }
                                control={form.control}
                                render={({ field }) => (
                                  <Switch
                                    id={inputId}
                                    checked={Boolean(field.value)}
                                    onCheckedChange={field.onChange}
                                  />
                                )}
                              />
                              <FieldLabel htmlFor={inputId} className="min-w-0 flex-1 font-normal">
                                {formatSportType(sportType)}
                              </FieldLabel>
                              <Controller
                                name={
                                  `sportTypes.${sportType}.color` as FieldPath<SettingsFormInput>
                                }
                                control={form.control}
                                render={({ field }) => {
                                  const color = sportColor(field.value, typeSettings?.color);
                                  return (
                                    <Select
                                      value={color}
                                      onValueChange={(next) => {
                                        if (next == null) return;
                                        field.onChange(String(next));
                                      }}
                                    >
                                      <SelectTrigger
                                        id={`${inputId}-color`}
                                        size="sm"
                                        className="w-28"
                                        aria-label={`${formatSportType(sportType)} color`}
                                      >
                                        <SelectValue>
                                          <span className="flex items-center gap-2">
                                            <ColorDot color={color} />
                                            {colorLabel(color)}
                                          </span>
                                        </SelectValue>
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectGroup>
                                          {ACTIVITY_COLOR_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                              <ColorDot color={option.value} />
                                              {option.label}
                                            </SelectItem>
                                          ))}
                                        </SelectGroup>
                                      </SelectContent>
                                    </Select>
                                  );
                                }}
                              />
                            </Field>
                            <FieldSet className="gap-2 ps-8">
                              <FieldLegend variant="label">Collectors</FieldLegend>
                              <FieldGroup className="flex-row flex-wrap gap-4">
                                <Field orientation="horizontal">
                                  <Controller
                                    name={
                                      `sportTypes.${sportType}.heartRate` as FieldPath<SettingsFormInput>
                                    }
                                    control={form.control}
                                    render={({ field }) => (
                                      <Switch
                                        id={heartId}
                                        checked={field.value !== false}
                                        onCheckedChange={field.onChange}
                                      />
                                    )}
                                  />
                                  <FieldLabel htmlFor={heartId} className="font-normal">
                                    {heartRateCollectorLabel(sportType)}
                                  </FieldLabel>
                                </Field>
                                {offersPower ? (
                                  <Field orientation="horizontal">
                                    <Controller
                                      name={
                                        `sportTypes.${sportType}.power` as FieldPath<SettingsFormInput>
                                      }
                                      control={form.control}
                                      render={({ field }) => (
                                        <Switch
                                          id={powerId}
                                          checked={field.value === true}
                                          onCheckedChange={field.onChange}
                                        />
                                      )}
                                    />
                                    <FieldLabel htmlFor={powerId} className="font-normal">
                                      Power meter
                                    </FieldLabel>
                                  </Field>
                                ) : null}
                              </FieldGroup>
                            </FieldSet>
                          </FieldGroup>
                        );
                      })}
                    </FieldGroup>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
          <ResponsiveDialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
            {saveError ? <p className="text-destructive me-auto text-xs">{saveError}</p> : null}
            <ResponsiveDialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </ResponsiveDialogClose>
            <Button type="submit" disabled={!data || save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
