"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDaysIcon, CheckIcon, ChevronLeftIcon } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  assessmentsQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
} from "#/lib/queries.ts";
import {
  TRAINING_PACE_FIELDS,
  TRAINING_WEEK_FIELDS,
  trainingFormDefaults,
  trainingFormSchema,
  trainingFromForm,
  type TrainingFormInput,
  type TrainingFormValues,
} from "#/lib/settings-form.ts";
import { saveAppSettings } from "#/services/app-settings.ts";
import { DEFAULT_SPORT_GROUP_SHARES, mergeSportGroupShares } from "#/services/sport-groups.ts";
import { recentAverageWeeklyHours } from "#/services/training-plan.ts";
import { cn } from "cn";
import { IconStack } from "@/components/reui/icon-stack";
import { TrainingPaceFields, TrainingWeekFields } from "#/components/settings-fields.tsx";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "#/components/responsive-dialog.tsx";
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
    description: "Open the calendar to fill this week's bucket.",
  },
] as const;

export function OnboardingDialog({
  open,
  onOpenChange,
  userName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ ...homeQueryOptions, enabled: open });
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const avgHours = useMemo(
    () => (data ? recentAverageWeeklyHours(data.fitnessLoads, timeZone) : 0),
    [data, timeZone],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hydrated = useRef(false);
  const form = useForm<TrainingFormInput, unknown, TrainingFormValues>({
    resolver: zodResolver(trainingFormSchema),
    defaultValues: trainingFormDefaults(null, 5, timeZone),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    if (!open) {
      hydrated.current = false;
      return;
    }
    if (!data || hydrated.current) return;
    hydrated.current = true;
    setStepIndex(0);
    setSaveError(null);
    form.reset(trainingFormDefaults(data.training, avgHours, timeZone));
  }, [open, data, avgHours, timeZone, form]);

  const step = STEPS[stepIndex];

  const save = useMutation({
    mutationFn: saveAppSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(homeQueryOptions.queryKey, (current) =>
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
    if (next > stepIndex) return;
    setStepIndex(next);
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
      if (!data) return;
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
    <ResponsiveDialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next && !isReady) {
          details?.cancel?.();
          return;
        }
        onOpenChange(next);
      }}
    >
      <ResponsiveDialogContent
        showCloseButton={isReady}
        className="flex h-[min(40rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 [--drawer-content-height:min(40rem,calc(100dvh-2rem))] sm:max-w-lg"
      >
        <ResponsiveDialogHeader className="gap-2 border-b px-4 pt-4 pb-3 group-data-[swipe-axis=y]/drawer-popup:text-left">
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
          <ResponsiveDialogTitle className="text-base font-semibold">
            {step.id === "pace" ? `Welcome, ${firstName}` : step.title}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{step.description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void continueStep();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              key={step.id}
              className="flex flex-col gap-4 p-4 pb-6 animate-in fade-in-0 slide-in-from-right-2 duration-200"
            >
              {!data && !isReady ? (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              ) : step.id === "pace" ? (
                <TrainingPaceFields idPrefix="onboard" control={form.control} />
              ) : step.id === "week" ? (
                <TrainingWeekFields
                  idPrefix="onboard"
                  control={form.control}
                  setValue={form.setValue}
                  avgHours={avgHours}
                  includeDoubleDays={false}
                />
              ) : (
                <Empty className="min-h-64 border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="default">
                      <IconStack>
                        <CheckIcon className="size-5" />
                      </IconStack>
                    </EmptyMedia>
                    <EmptyTitle>Ready to train</EmptyTitle>
                    <EmptyDescription>
                      Your goal is saved. Open the calendar to fill this week, or change anything
                      later from Settings.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>
          <ResponsiveDialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
            {saveError ? (
              <p className="text-destructive me-auto w-full text-xs sm:w-auto">{saveError}</p>
            ) : null}
            {isReady ? (
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
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
                <Button type="submit" disabled={save.isPending || !data}>
                  {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {step.id === "week" ? "Finish" : "Continue"}
                </Button>
              </>
            )}
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
