"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Controller, useForm, useWatch, type FieldErrors, type FieldPath } from "react-hook-form";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
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
import {
  isSettingsPath,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/lib/settings-sections.ts";
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
import { hasRecentWeeklyHours, recentAverageWeeklyHours } from "@/services/training-plan.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ProfileFields,
  TrainingPaceFields,
  TrainingStyleFields,
  TrainingDoubleDaysField,
  TrainingWeekFields,
} from "@/components/settings-fields.tsx";
import { SettingsDeleteAthlete } from "@/components/settings-delete-athlete.tsx";
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
import { toast } from "@/components/ui/toast";

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

export function SettingsForm({
  section,
  userName,
}: {
  section: SettingsSection;
  userName: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery(settingsSnapshotQueryOptions);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const avgHours = useMemo(
    () => (data ? recentAverageWeeklyHours(data.fitnessLoads, timeZone) : 0),
    [data?.fitnessLoads, timeZone],
  );
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
  const { isDirty } = form.formState;
  // Switching sections keeps the form mounted; only leaving settings drops unsaved edits.
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => isDirty && !isSettingsPath(next.pathname),
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });
  const sectionLabel =
    SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? SETTINGS_SECTIONS[0].label;

  function setSection(next: SettingsSection) {
    void navigate({ to: "/settings/$section", params: { section: next } });
  }

  const sportTypes = (useWatch({ control: form.control, name: "sportTypes" }) ??
    {}) as CalendarSettings["sportTypes"];

  useEffect(() => {
    if (!data) return;
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
  }, [data?.profile, data?.training, data?.settings, data?.fitnessLoads, timeZone, form]);

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
      setSaveError(null);
      toast.add({ type: "success", title: "Settings saved" });
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
    <>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
      >
        <div className="flex flex-col gap-2">
          <div className="flex min-h-7 items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {sectionLabel}
            </h1>
            {section === "sync" ? null : (
              <Button type="submit" className="shrink-0" disabled={!data || save.isPending}>
                {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                Save
              </Button>
            )}
          </div>
          {saveError ? <p className="text-destructive text-xs">{saveError}</p> : null}
        </div>
        <div className="flex flex-col rounded-xl border bg-card">
          <div className="flex flex-col gap-4 p-4">
            {!data ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : section === "profile" ? (
              <>
                <ProfileFields idPrefix="settings" userName={userName} control={form.control} />
                <FieldSeparator />
                <SettingsDeleteAthlete />
              </>
            ) : section === "training" ? (
              <FieldGroup>
                <TrainingPaceFields
                  idPrefix="settings"
                  control={form.control}
                  hasActivityHistory={hasRecentWeeklyHours(avgHours)}
                />
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
              <SettingsSyncSection enabled />
            ) : sortedSports.length === 0 ? (
              <Empty className="min-h-48 border">
                <EmptyHeader>
                  <EmptyTitle>No activity types yet</EmptyTitle>
                  <EmptyDescription>
                    Sync from Strava to choose which sports appear in the calendar, map, and heart
                    rate.
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
                        When on, types in the group share one max heart rate and zone set — a peak
                        on a gravel ride also sets indoor and road ride zones.
                      </FieldDescription>
                      {shareableGroups.map((group) => {
                        const inputId = `app-group-${group.id}`;
                        const name = `sportGroupShares.${group.id}` as FieldPath<SettingsFormInput>;
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
                  These types and colors apply to the calendar, map, heart rate, and other views.
                  Mark the hardware you actually use — Ride with an HR belt and power-meter pedals,
                  gravel with a belt only, running with an HR watch — so structured sessions can
                  prescribe watts, heart rate, or RPE.
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
                          name={`sportTypes.${sportType}.visible` as FieldPath<SettingsFormInput>}
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
                          name={`sportTypes.${sportType}.color` as FieldPath<SettingsFormInput>}
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
        </div>
      </form>
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your settings edits have not been saved. Leaving settings drops them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
