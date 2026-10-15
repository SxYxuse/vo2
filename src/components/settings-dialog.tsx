"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, TargetIcon, UserIcon } from "lucide-react";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  assessmentsQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
} from "#/lib/queries.ts";
import { saveAppSettings, type ProfileSettings } from "#/services/app-settings.ts";
import {
  ACTIVITY_COLOR_OPTIONS,
  formatSportType,
  heartRateCollectorLabel,
  sortSportTypeKeys,
  sportOffersPower,
  type CalendarSettings,
} from "#/services/calendar-settings.ts";
import {
  DEFAULT_SPORT_GROUP_SHARES,
  SPORT_GROUPS,
  mergeSportGroupShares,
} from "#/services/sport-groups.ts";
import { recentAverageWeeklyHours, trainingConsistency } from "#/services/training-plan.ts";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "#/components/responsive-dialog.tsx";
import {
  ProfileFields,
  TrainingPaceFields,
  TrainingStyleFields,
  TrainingWeekFields,
  draftFromPlan,
  optionalNumber,
  parseDraft,
  validateProfileInputs,
  type ProfileFieldErrors,
  type TrainingDraft,
} from "#/components/settings-fields.tsx";
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

type SettingsSection = "profile" | "sports" | "training";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "training", label: "Training", icon: TargetIcon },
  { id: "sports", label: "Sports", icon: ActivityIcon },
];

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
  const { data } = useQuery({ ...homeQueryOptions, enabled: open });
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const avgHours = useMemo(
    () => (data ? recentAverageWeeklyHours(data.fitnessLoads, timeZone) : 0),
    [data, timeZone],
  );
  const [section, setSection] = useState<SettingsSection>("profile");
  const [profile, setProfile] = useState<ProfileSettings>(
    data?.profile ?? {
      birthDate: null,
      weightKg: null,
      heightCm: null,
    },
  );
  const [weightInput, setWeightInput] = useState(
    data?.profile.weightKg != null ? String(data.profile.weightKg) : "",
  );
  const [heightInput, setHeightInput] = useState(
    data?.profile.heightCm != null ? String(data.profile.heightCm) : "",
  );
  const [sportTypes, setSportTypes] = useState<CalendarSettings["sportTypes"]>(
    data?.settings.sportTypes ?? {},
  );
  const [sportGroupShares, setSportGroupShares] = useState(DEFAULT_SPORT_GROUP_SHARES);
  const [draft, setDraft] = useState<TrainingDraft>(() => draftFromPlan(null, 5));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [trainingError, setTrainingError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    setSection("profile");
    setProfile(data.profile);
    setWeightInput(data.profile.weightKg != null ? String(data.profile.weightKg) : "");
    setHeightInput(data.profile.heightCm != null ? String(data.profile.heightCm) : "");
    setSportTypes(data.settings.sportTypes);
    setSportGroupShares(mergeSportGroupShares(data.settings.sportGroupShares));
    setDraft(draftFromPlan(data.training, recentAverageWeeklyHours(data.fitnessLoads, timeZone)));
    setSaveError(null);
    setFieldErrors({});
    setTrainingError(null);
  }, [open, data, timeZone]);

  const sortedSports = useMemo(() => sortSportTypeKeys(sportTypes), [sportTypes]);
  const shareableGroups = useMemo(
    () =>
      SPORT_GROUPS.map((group) => ({
        ...group,
        members: group.members.filter((member) => sportTypes[member]),
      })).filter((group) => group.members.length >= 2),
    [sportTypes],
  );
  const parsedTraining = parseDraft(draft, timeZone);
  const consistency = parsedTraining.success
    ? trainingConsistency(parsedTraining.data)
    : { ok: false, message: draft.buildPace ? null : "Choose how hard you want to build fitness." };

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
      onOpenChange(false);
    },
    onError: (caught) => {
      setSaveError(caught instanceof Error ? caught.message : "Could not save settings");
    },
  });

  function submit() {
    const nextErrors = validateProfileInputs(weightInput, heightInput);
    setFieldErrors(nextErrors);
    if (nextErrors.weight || nextErrors.height) {
      setSection("profile");
      return;
    }
    if (!parsedTraining.success || !consistency.ok) {
      setSection("training");
      setTrainingError(consistency.message ?? "Fill in your training goal to continue.");
      setSaveError(consistency.message ?? "Fill in your training goal to continue.");
      return;
    }
    setTrainingError(null);
    save.mutate({
      data: {
        profile: {
          birthDate: profile.birthDate,
          weightKg: optionalNumber(weightInput),
          heightCm: optionalNumber(heightInput),
        },
        sportTypes,
        sportGroupShares,
        training: parsedTraining.data,
      },
    });
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        showCloseButton
        className="flex h-[min(40rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 [--drawer-content-height:min(40rem,calc(100dvh-2rem))] sm:max-w-3xl"
      >
        <ResponsiveDialogHeader className="border-b px-4 py-3 group-data-[swipe-axis=y]/drawer-popup:text-left">
          <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Profile, training goal, and sport types used across calendar, map, fitness, and heart
            rate.
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
                  <ProfileFields
                    idPrefix="settings"
                    userName={userName}
                    profile={profile}
                    setProfile={setProfile}
                    weightInput={weightInput}
                    setWeightInput={setWeightInput}
                    heightInput={heightInput}
                    setHeightInput={setHeightInput}
                    fieldErrors={fieldErrors}
                  />
                ) : section === "training" ? (
                  <FieldGroup>
                    <TrainingPaceFields
                      idPrefix="settings"
                      draft={draft}
                      setDraft={setDraft}
                      trainingError={trainingError}
                    />
                    <FieldSeparator />
                    <TrainingWeekFields
                      idPrefix="settings"
                      draft={draft}
                      setDraft={setDraft}
                      avgHours={avgHours}
                    />
                    <TrainingStyleFields
                      idPrefix="settings"
                      draft={draft}
                      setDraft={setDraft}
                      onOpenSports={() => setSection("sports")}
                    />
                  </FieldGroup>
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
                            return (
                              <Field key={group.id} orientation="horizontal">
                                <Switch
                                  id={inputId}
                                  checked={sportGroupShares[group.id]}
                                  onCheckedChange={(shared) =>
                                    setSportGroupShares((current) => ({
                                      ...current,
                                      [group.id]: shared,
                                    }))
                                  }
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
                            <Switch
                              id={inputId}
                              checked={typeSettings.visible}
                              onCheckedChange={(visible) =>
                                setSportTypes((current) => ({
                                  ...current,
                                  [sportType]: { ...typeSettings, visible },
                                }))
                              }
                            />
                            <FieldLabel htmlFor={inputId} className="min-w-0 flex-1 font-normal">
                              {formatSportType(sportType)}
                            </FieldLabel>
                            <Select
                              value={typeSettings.color}
                              onValueChange={(next) => {
                                if (next == null) return;
                                setSportTypes((current) => ({
                                  ...current,
                                  [sportType]: { ...typeSettings, color: String(next) },
                                }));
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
                                    <ColorDot color={typeSettings.color} />
                                    {colorLabel(typeSettings.color)}
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
                          </Field>
                          <FieldSet className="gap-2 ps-8">
                            <FieldLegend variant="label">Collectors</FieldLegend>
                            <FieldGroup className="flex-row flex-wrap gap-4">
                              <Field orientation="horizontal">
                                <Switch
                                  id={heartId}
                                  checked={typeSettings.heartRate !== false}
                                  onCheckedChange={(heartRate) =>
                                    setSportTypes((current) => ({
                                      ...current,
                                      [sportType]: { ...typeSettings, heartRate },
                                    }))
                                  }
                                />
                                <FieldLabel htmlFor={heartId} className="font-normal">
                                  {heartRateCollectorLabel(sportType)}
                                </FieldLabel>
                              </Field>
                              {offersPower ? (
                                <Field orientation="horizontal">
                                  <Switch
                                    id={powerId}
                                    checked={typeSettings.power === true}
                                    onCheckedChange={(power) =>
                                      setSportTypes((current) => ({
                                        ...current,
                                        [sportType]: { ...typeSettings, power },
                                      }))
                                    }
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
          <Button type="button" disabled={save.isPending} onClick={submit}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
