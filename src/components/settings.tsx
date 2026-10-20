"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useForm, type FieldErrors } from "react-hook-form";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  fitnessQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
  settingsSnapshotQueryOptions,
} from "@/lib/queries.ts";
import {
  profileFromForm,
  settingsFormDefaults,
  SPORTS_FIELDS,
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
import { DEFAULT_SPORT_GROUP_SHARES } from "@/services/sport-groups.ts";
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
  CalendarPeriodField,
  ProfileFields,
  TrainingPaceFields,
  TrainingStyleFields,
  TrainingDoubleDaysField,
  TrainingWeekFields,
} from "@/components/settings-fields.tsx";
import { SettingsDeleteAthlete } from "@/components/settings-delete-athlete.tsx";
import { SettingsSyncSection } from "@/components/settings-sync-section.tsx";
import { SportTypesFields } from "@/components/sport-types-fields.tsx";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

const PROFILE_ERROR_KEYS = ["birthDate", "weightKg", "heightCm"] as const;

function sectionForErrors(errors: FieldErrors<SettingsFormInput>): SettingsSection {
  if (PROFILE_ERROR_KEYS.some((key) => errors[key])) return "profile";
  if (SPORTS_FIELDS.some((key) => errors[key])) return "sports";
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

  useEffect(() => {
    if (!data) return;
    setSaveError(null);
    form.reset(
      settingsFormDefaults({
        profile: data.profile,
        training: data.training,
        sportTypes: data.settings.sportTypes,
        sportGroupShares: data.settings.sportGroupShares,
        calendarPeriod: data.settings.calendarPeriod,
        avgHours: recentAverageWeeklyHours(data.fitnessLoads, timeZone),
        timeZone,
      }),
    );
  }, [data?.profile, data?.training, data?.settings, data?.fitnessLoads, timeZone, form]);

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
      void queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
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
        calendarPeriod: values.calendarPeriod,
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
              <Button
                type="submit"
                className="shrink-0"
                disabled={!data || !isDirty || save.isPending}
              >
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
            ) : section === "calendar" ? (
              <CalendarPeriodField idPrefix="settings" control={form.control} />
            ) : section === "sync" ? (
              <SettingsSyncSection enabled />
            ) : (
              <SportTypesFields idPrefix="settings" control={form.control} />
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
