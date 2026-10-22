"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDaysIcon, CheckIcon, ChevronLeftIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";

import { settingsSnapshotQueryOptions, syncStatusQueryOptions } from "@/lib/queries.ts";
import { afterProfileSaved, afterSettingsSaved } from "@/lib/query-events.ts";
import {
  PROFILE_FIELDS,
  SPORTS_FIELDS,
  TRAINING_PACE_FIELDS,
  TRAINING_WEEK_FIELDS,
  onboardingFormDefaults,
  onboardingFormSchema,
  profileFormSchema,
  profileFormDefaults,
  profileFromForm,
  trainingFromForm,
  type OnboardingFormInput,
  type OnboardingFormValues,
  type ProfileFormValues,
} from "@/lib/settings-form.ts";
import { useStravaSync } from "@/hooks/use-strava-sync.ts";
import { useSyncAutoResume } from "@/hooks/use-sync-auto-resume.ts";
import { saveAthleteSettings, saveProfile } from "@/services/athlete-settings.ts";
import { hidesEverySportType, SHOW_ONE_SPORT_MESSAGE } from "@/services/athlete-settings.types.ts";
import { onboardingSyncStep } from "@/services/onboarding-sync.ts";
import { hasRecentWeeklyHours, recentAverageWeeklyHours } from "@/services/training-plan.ts";
import { cn } from "cn";
import { IconStack } from "@/components/reui/icon-stack";
import { OnboardingSyncStepPanel } from "@/components/onboarding-sync-step.tsx";
import { SportTypesFields } from "@/components/sport-types-fields.tsx";
import {
  BirthDateField,
  TrainingPaceFields,
  TrainingWeekFields,
  WeightField,
} from "@/components/settings-fields.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const STEPS = [
  {
    id: "sync",
    title: "Copy from Strava",
    description: "Copy your activities first so your plan starts from real training.",
  },
  {
    id: "about",
    title: "About you",
    description:
      "Your birthday, to check heart-rate peaks against your age, and your weight, to cap caffeine in fuel plans.",
  },
  {
    id: "sports",
    title: "Your sports",
    description:
      "Choose what shows in your calendar, map, and heart rate, and the gear you train with.",
  },
  {
    id: "pace",
    title: "Fitness goal",
    description: "How hard you want to build — this drives weekly load.",
  },
  {
    id: "week",
    title: "Your week",
    description: "How the weekly target is set, and a preferred rest day.",
  },
  {
    id: "ready",
    title: "You're set",
    description: "Open the calendar to see your week.",
  },
] as const;

export function OnboardingForm({ userName }: { userName: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(settingsSnapshotQueryOptions);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const avgHours = useMemo(
    () => recentAverageWeeklyHours(data.fitnessLoads, timeZone),
    [data.fitnessLoads, timeZone],
  );
  const hasActivityHistory = hasRecentWeeklyHours(avgHours);
  const [stepIndex, setStepIndex] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const defaults = useMemo(
    () =>
      onboardingFormDefaults({
        profile: data.profile,
        training: data.training,
        sportTypes: data.settings.sportTypes,
        sportGroupShares: data.settings.sportGroupShares,
        avgHours,
        timeZone,
      }),
    [data.profile, data.training, data.settings, avgHours, timeZone],
  );
  const form = useForm<OnboardingFormInput, unknown, OnboardingFormValues>({
    resolver: zodResolver(onboardingFormSchema),
    defaultValues: defaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const step = STEPS[stepIndex];
  const sportTypes = useWatch({ control: form.control, name: "sportTypes" }) ?? {};
  const birthDate = useWatch({ control: form.control, name: "birthDate" });
  const weightKg = useWatch({ control: form.control, name: "weightKg" });
  // Steps validate with trigger, not submit, so react-hook-form never revalidates on change.
  useEffect(() => {
    if (birthDate) form.clearErrors("birthDate");
  }, [birthDate, form]);
  useEffect(() => {
    if (weightKg) form.clearErrors("weightKg");
  }, [weightKg, form]);
  const hasSportTypes = Object.keys(sportTypes).length > 0;
  const hidesEverySport = hidesEverySportType(sportTypes);
  const { data: syncStatus = null, isPending: syncStatusPending } =
    useQuery(syncStatusQueryOptions);
  const sync = useStravaSync({ quiet: true });
  useSyncAutoResume();
  const syncStep = onboardingSyncStep({
    status: syncStatus?.status ?? "never",
    syncing: sync.isPending,
    syncFailed: sync.error != null || Boolean(sync.lastResult?.lastError),
    syncPaused: Boolean(sync.lastResult?.pausedUntil),
    activityCount: syncStatus?.activityCount ?? 0,
  });

  const save = useMutation({
    mutationFn: saveAthleteSettings,
    onSuccess: (saved) => {
      // Marking the profile done keeps the onboarding route on "You're set" instead of the
      // profile prompt.
      void afterSettingsSaved(queryClient, saved, { profileDone: true });
      setSaveError(null);
      setStepIndex(STEPS.length - 1);
    },
    onError: (caught) => {
      setSaveError(caught instanceof Error ? caught.message : "Could not save your setup");
    },
  });

  function goToStep(next: number) {
    if (next < 0 || next >= STEPS.length) return;
    setStepIndex((current) => (next > current ? current : next));
  }

  async function continueStep() {
    if (step.id === "sync") {
      if (!syncStep.canContinue) return;
      // Defaults read the history this sync just copied; keep anything already edited.
      form.reset(defaults, { keepDirtyValues: true });
      setStepIndex((current) => current + 1);
      return;
    }
    if (step.id === "about") {
      const ok = await form.trigger([...PROFILE_FIELDS]);
      if (!ok) return;
      setStepIndex((current) => current + 1);
      return;
    }
    if (step.id === "sports") {
      const ok = await form.trigger([...SPORTS_FIELDS]);
      if (!ok) return;
      setStepIndex((current) => current + 1);
      return;
    }
    if (step.id === "pace") {
      const ok = await form.trigger([...TRAINING_PACE_FIELDS]);
      if (!ok) return;
      setStepIndex((current) => current + 1);
      return;
    }
    if (step.id !== "week") return;
    const ok = await form.trigger([
      ...PROFILE_FIELDS,
      ...SPORTS_FIELDS,
      ...TRAINING_PACE_FIELDS,
      ...TRAINING_WEEK_FIELDS,
    ]);
    if (!ok) return;
    await form.handleSubmit((values) => {
      save.mutate({
        data: {
          profile: profileFromForm(values),
          sportTypes: values.sportTypes,
          sportGroupShares: values.sportGroupShares,
          training: trainingFromForm(values),
        },
      });
    })();
  }

  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const isReady = step.id === "ready";
  const copyUnfinished = syncStatus?.status !== "complete";

  return (
    <form
      noValidate
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void continueStep();
      }}
    >
      <Card>
        <CardHeader className="justify-items-center border-b text-center">
          <div
            className="flex items-center justify-center gap-1.5"
            role="tablist"
            aria-label="Setup steps"
          >
            {STEPS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-label={item.title}
                aria-current={index === stepIndex ? "step" : undefined}
                disabled={isReady || index > stepIndex}
                className={cn(
                  "size-2.5 rounded-full transition-colors",
                  index === stepIndex
                    ? "bg-primary"
                    : index < stepIndex
                      ? "bg-primary/50"
                      : "bg-muted",
                )}
                onClick={() => goToStep(index)}
              />
            ))}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {step.id === "sync" ? `Welcome, ${firstName}` : step.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {step.id === "sync"
              ? "Start by copying your activities from Strava."
              : step.id === "pace" && !hasActivityHistory
                ? "How hard you want this block to push — fitness and form come after activities are copied."
                : step.id === "week" && !hasActivityHistory
                  ? "How many hours you want to train each week."
                  : step.description}
          </p>
        </CardHeader>
        <CardContent>
          <div
            key={step.id}
            className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200"
          >
            {step.id === "sync" ? (
              syncStatusPending ? (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              ) : (
                <OnboardingSyncStepPanel
                  step={syncStep}
                  status={syncStatus}
                  error={sync.error?.message ?? null}
                  onSync={() => sync.mutate()}
                />
              )
            ) : step.id === "about" ? (
              <>
                <BirthDateField idPrefix="onboard" control={form.control} />
                <WeightField idPrefix="onboard" control={form.control} />
              </>
            ) : step.id === "sports" ? (
              <>
                <SportTypesFields idPrefix="onboard" control={form.control} />
                {hidesEverySport ? (
                  <FieldError>{SHOW_ONE_SPORT_MESSAGE}</FieldError>
                ) : hasSportTypes ? (
                  <FieldDescription>
                    More sports appear here as your history finishes copying. Change them anytime in
                    Settings.
                  </FieldDescription>
                ) : null}
              </>
            ) : step.id === "pace" ? (
              <TrainingPaceFields
                idPrefix="onboard"
                control={form.control}
                hasActivityHistory={hasActivityHistory}
              />
            ) : step.id === "week" ? (
              <TrainingWeekFields
                idPrefix="onboard"
                control={form.control}
                setValue={form.setValue}
                avgHours={avgHours}
              />
            ) : (
              <Empty className="min-h-48 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="default">
                    <IconStack>
                      <CheckIcon className="size-5" />
                    </IconStack>
                  </EmptyMedia>
                  <EmptyTitle>Ready to train</EmptyTitle>
                  <EmptyDescription>
                    {copyUnfinished
                      ? "Your goal is saved. Older history and streams keep copying while VO2 is open, and the copy picks up again on its own after a Strava pause. You can change anything later from Settings."
                      : "Your goal is saved. Open the calendar to see your week, or change anything later from Settings."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2 border-t">
          {saveError ? (
            <Alert variant="destructive" className="me-auto w-full sm:w-auto">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}
          {isReady ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => {
                void navigate({ to: "/" });
              }}
            >
              <CalendarDaysIcon data-icon="inline-start" />
              Open calendar
            </Button>
          ) : (
            <>
              {stepIndex > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="me-auto"
                  onClick={() => setStepIndex((current) => current - 1)}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Back
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  (step.id === "sync" && !syncStep.canContinue) ||
                  (step.id === "sports" && hidesEverySport)
                }
              >
                {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                {step.id === "week" ? "Finish" : "Continue"}
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </form>
  );
}

/** One-step setup for athletes who finished onboarding before the birthday and weight were required. */
export function ProfilePrompt() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(settingsSnapshotQueryOptions);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: profileFormDefaults(data.profile),
  });
  const save = useMutation({
    mutationFn: saveProfile,
    onSuccess: async () => {
      void afterProfileSaved(queryClient);
      await navigate({ to: "/" });
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col overflow-hidden rounded-xl border bg-card"
      onSubmit={form.handleSubmit((values) => save.mutate({ data: profileFromForm(values) }))}
    >
      <div className="flex flex-col gap-2 border-b px-4 pt-4 pb-3 text-center">
        <h1 className="text-xl font-semibold tracking-tight">About you</h1>
        <p className="text-muted-foreground text-sm">
          VO2 checks heart-rate peaks against your age and caps caffeine in fuel plans by your
          weight. Add both to continue.
        </p>
      </div>
      <div className="flex flex-col gap-4 p-4 pb-6">
        <BirthDateField idPrefix="profile-prompt" control={form.control} />
        <WeightField idPrefix="profile-prompt" control={form.control} />
      </div>
      <div className="flex flex-row flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        {save.error ? (
          <p className="text-destructive me-auto w-full text-xs sm:w-auto">
            {save.error.message || "Could not save your profile"}
          </p>
        ) : null}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Continue
        </Button>
      </div>
    </form>
  );
}
