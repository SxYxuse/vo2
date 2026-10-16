"use client";

import { useMemo, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronLeftIcon, ClipboardListIcon } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  assessmentsQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
  settingsSnapshotQueryOptions,
} from "@/lib/queries.ts";
import {
  TRAINING_PACE_FIELDS,
  TRAINING_WEEK_FIELDS,
  trainingFormDefaults,
  trainingFormSchema,
  trainingFromForm,
  type TrainingFormInput,
  type TrainingFormValues,
} from "@/lib/settings-form.ts";
import { saveAppSettings } from "@/services/app-settings.ts";
import { DEFAULT_SPORT_GROUP_SHARES, mergeSportGroupShares } from "@/services/sport-groups.ts";
import { hasRecentWeeklyHours, recentAverageWeeklyHours } from "@/services/training-plan.ts";
import { cn } from "cn";
import { IconStack } from "@/components/reui/icon-stack";
import { TrainingPaceFields, TrainingWeekFields } from "@/components/settings-fields.tsx";
import { Vo2Wordmark } from "@/components/vo2-mark.tsx";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

const STEPS = [
  {
    id: "pace",
    title: "Fitness goal",
    description: "How hard you want to build — this drives weekly load.",
  },
  {
    id: "week",
    title: "Your week",
    description: "Session caps, hours, and a preferred rest day.",
  },
  {
    id: "ready",
    title: "You're set",
    description: "Open the week bucket to fill this week.",
  },
] as const;

export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center text-lg font-semibold">
          <Vo2Wordmark />
        </div>
      </header>
      <main className="flex flex-1 justify-center overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <div className="my-auto w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}

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
    () => trainingFormDefaults(data.training, avgHours, timeZone),
    [data.training, avgHours, timeZone],
  );
  const form = useForm<TrainingFormInput, unknown, TrainingFormValues>({
    resolver: zodResolver(trainingFormSchema),
    defaultValues: defaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const step = STEPS[stepIndex];

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
    if (step.id === "pace") {
      const ok = await form.trigger([...TRAINING_PACE_FIELDS]);
      if (!ok) return;
      setStepIndex(1);
      return;
    }
    if (step.id !== "week") return;
    const ok = await form.trigger([...TRAINING_PACE_FIELDS, ...TRAINING_WEEK_FIELDS]);
    if (!ok) return;
    await form.handleSubmit((values) => {
      save.mutate({
        data: {
          profile: data.profile,
          sportTypes: data.settings.sportTypes,
          sportGroupShares: mergeSportGroupShares(
            data.settings.sportGroupShares ?? DEFAULT_SPORT_GROUP_SHARES,
          ),
          training: trainingFromForm(values),
        },
      });
    })();
  }

  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const isReady = step.id === "ready";

  return (
    <form
      noValidate
      className="flex flex-col overflow-hidden rounded-xl border bg-card"
      onSubmit={(event) => {
        event.preventDefault();
        void continueStep();
      }}
    >
      <div className="flex flex-col gap-2 border-b px-4 pt-4 pb-3 text-center">
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
          {step.id === "pace" ? `Welcome, ${firstName}` : step.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {step.id === "pace" && !hasActivityHistory
            ? "How hard you want this block to push — fitness and form come after activities are copied."
            : step.id === "week" && !hasActivityHistory
              ? "How many runs, rides, and hours you want each week."
              : step.id === "ready" && !hasActivityHistory
                ? "Copy activities from Strava, then fill this week."
                : step.description}
        </p>
      </div>
      <div className="flex flex-col gap-4 p-4 pb-6">
        <div
          key={step.id}
          className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-right-2 duration-200"
        >
          {step.id === "pace" ? (
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
                  {hasActivityHistory
                    ? "Your goal is saved. Open the week bucket to fill this week, or change anything later from Settings."
                    : "Your goal is saved. Copy activities from Strava, then open the week bucket. You can change anything later from Settings."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
      <div className="flex flex-row flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        {saveError ? (
          <p className="text-destructive me-auto w-full text-xs sm:w-auto">{saveError}</p>
        ) : null}
        {isReady ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => {
              void navigate({ to: "/week-bucket" });
            }}
          >
            <ClipboardListIcon data-icon="inline-start" />
            Open week bucket
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
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              {step.id === "week" ? "Finish" : "Continue"}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
