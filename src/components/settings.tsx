"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useForm } from "react-hook-form";

import { settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { afterSettingsSaved } from "@/lib/query-events.ts";
import {
  settingsFormDefaults,
  settingsFormSchema,
  settingsSaveFromForm,
  type SettingsFormInput,
  type SettingsFormValues,
} from "@/lib/settings-form.ts";
import {
  isSettingsPath,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/lib/settings-sections.ts";
import { saveAthleteSettings } from "@/services/athlete-settings.ts";
import { DEFAULT_SPORT_GROUP_SHARES } from "@/services/sport-groups.ts";
import { dayKey } from "@/services/training-plan.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  CalendarPeriodField,
  CelebrateTopEffortsField,
  PlanSummary,
  ProfileFields,
  TrainingShapeField,
} from "@/components/settings-fields.tsx";
import { HeartRateFields } from "@/components/heart-rate-fields.tsx";
import { SettingsDeleteAthlete } from "@/components/settings-delete-athlete.tsx";
import { SettingsSyncSection } from "@/components/settings-sync-section.tsx";
import { SportTypesFields } from "@/components/sport-types-fields.tsx";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

// Sliders report every step; waiting this long after the last one saves once the thumb settles.
const SAVE_DELAY_MS = 400;
// Typed fields save on blur, so a weight is not saved one keystroke at a time.
function isTypedField(name: string) {
  return name === "weightKg" || (name.startsWith("heartRate.") && !name.endsWith(".method"));
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function SettingsForm({
  section,
  userName,
}: {
  section: SettingsSection;
  userName: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery(settingsSnapshotQueryOptions);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef(false);
  const changedSinceSave = useRef(false);
  const emptyDefaults = useMemo(
    () =>
      settingsFormDefaults({
        profile: null,
        training: null,
        sportTypes: {},
        sportGroupShares: DEFAULT_SPORT_GROUP_SHARES,
        timeZone,
      }),
    [timeZone],
  );
  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: emptyDefaults,
    mode: "onTouched",
  });
  // A save in flight finishes after leaving settings; only a failed one would be lost silently.
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => status === "error" && !isSettingsPath(next.pathname),
    enableBeforeUnload: () => status === "error" || saving.current || timer.current != null,
    withResolver: true,
  });
  const sectionLabel =
    SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? SETTINGS_SECTIONS[0].label;

  useEffect(() => {
    if (!data) return;
    // Saved values come back while the athlete may still be editing; keep what they changed.
    form.reset(
      settingsFormDefaults({
        profile: data.profile,
        training: data.training,
        heartRate: data.heartRate,
        sportTypes: data.settings.sportTypes,
        sportGroupShares: data.settings.sportGroupShares,
        calendarPeriod: data.settings.calendarPeriod,
        celebrateTopEfforts: data.settings.topEffortsSince != null,
        timeZone,
      }),
      { keepDirtyValues: true, keepErrors: true },
    );
  }, [data?.profile, data?.training, data?.settings, data?.heartRate, timeZone, form]);

  // One save at a time, each sending the form as it is when it starts, so the latest edit wins.
  // A plain promise rather than a mutation keeps saving after the form unmounts.
  async function saveChanges() {
    while (changedSinceSave.current) {
      changedSinceSave.current = false;
      const saved = queryClient.getQueryData(settingsSnapshotQueryOptions.queryKey);
      const payload = saved ? settingsSaveFromForm(form.getValues(), saved) : null;
      if (!payload) continue;
      void afterSettingsSaved(queryClient, await saveAthleteSettings({ data: payload }));
    }
  }

  function requestSave() {
    clearTimeout(timer.current);
    timer.current = undefined;
    changedSinceSave.current = true;
    void form.trigger();
    if (saving.current) return;
    saving.current = true;
    setStatus("saving");
    setSaveError(null);
    saveChanges()
      .then(
        () => setStatus("saved"),
        (caught: unknown) => {
          setSaveError(caught instanceof Error ? caught.message : "Could not save settings");
          setStatus("error");
        },
      )
      .finally(() => {
        saving.current = false;
      });
  }

  useEffect(() => {
    const subscription = form.watch((_values, { name, type }) => {
      if (type !== "change" || !name || isTypedField(name)) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(requestSave, SAVE_DELAY_MS);
    });
    // Backgrounding the PWA or leaving settings must not drop a change still waiting to save.
    const flush = () => {
      if (timer.current != null) requestSave();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [form]);

  useEffect(() => {
    if (status !== "saved") return;
    const fade = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(fade);
  }, [status]);

  return (
    <>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          requestSave();
        }}
        onBlur={(event) => {
          const name = event.target.getAttribute("name");
          if (name && isTypedField(name) && form.getFieldState(name as "weightKg").isDirty) {
            requestSave();
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="flex min-h-7 items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {sectionLabel}
            </h1>
            <p
              aria-live="polite"
              className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"
            >
              {status === "saving" ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : status === "saved" ? (
                <>
                  <CheckIcon className="size-4" />
                  Saved
                </>
              ) : null}
            </p>
          </div>
          {saveError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
              <AlertAction>
                <Button type="button" size="sm" variant="outline" onClick={requestSave}>
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4">
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
                <PlanSummary
                  plan={data.training}
                  today={dayKey(new Date(), data.training?.timeZone ?? timeZone)}
                />
                {data.training ? (
                  <>
                    <FieldSeparator />
                    <TrainingShapeField control={form.control} />
                  </>
                ) : null}
              </FieldGroup>
            ) : section === "calendar" ? (
              <CalendarPeriodField idPrefix="settings" control={form.control} />
            ) : section === "bests" ? (
              <CelebrateTopEffortsField idPrefix="settings" control={form.control} />
            ) : section === "sync" ? (
              <SettingsSyncSection enabled />
            ) : section === "heart-rate" ? (
              <HeartRateFields
                idPrefix="settings"
                control={form.control}
                setValue={form.setValue}
                estimates={data.heartRateEstimates}
                onSave={requestSave}
              />
            ) : (
              <SportTypesFields idPrefix="settings" control={form.control} />
            )}
          </CardContent>
        </Card>
      </form>
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your last change hasn't saved yet. Leaving settings drops it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
