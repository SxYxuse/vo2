"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ActivityIcon,
  CalendarIcon,
  RulerIcon,
  TargetIcon,
  UserIcon,
  WeightIcon,
} from "lucide-react";

import {
  activityMapQueryOptions,
  appShellQueryOptions,
  assessmentsQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
} from "#/lib/queries.ts";
import {
  ageFromBirthDate,
  formatBirthDate,
  parseBirthDate,
  saveAppSettings,
  type ProfileSettings,
} from "#/services/app-settings.ts";
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
import {
  BUILD_PACES,
  HOURS_INTENTS,
  WEEKDAYS,
  WORKOUT_STYLES,
  formatHours,
  isTrainingPlanComplete,
  recentAverageWeeklyHours,
  suggestedTargetHours,
  trainingConsistency,
  trainingPlanSchema,
  type BuildPace,
  type HoursIntent,
  type TrainingPlan,
  type WorkoutStyle,
} from "#/services/training-plan.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type SettingsSection = "profile" | "sports" | "training";

type TrainingDraft = {
  buildPace: BuildPace | "";
  maxRunSessions: number;
  maxRideSessions: number;
  maxDoubleDays: number;
  hoursIntent: HoursIntent;
  workoutStyle: WorkoutStyle;
  targetWeeklyHours: number;
  preferredRestWeekday: number;
  suggestFtpTest: boolean;
  suggestBeepTest: boolean;
  suggestRunLthrTest: boolean;
};

const SECTIONS: { id: SettingsSection; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "training", label: "Training", icon: TargetIcon },
  { id: "sports", label: "Sports", icon: ActivityIcon },
];

const SESSION_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7];
const DOUBLE_DAY_COUNTS = [0, 1, 2, 3, 4, 5, 6];

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

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function draftFromPlan(plan: TrainingPlan | null, avgHours: number): TrainingDraft {
  if (plan) {
    return {
      buildPace: plan.buildPace,
      maxRunSessions: plan.maxRunSessions,
      maxRideSessions: plan.maxRideSessions,
      maxDoubleDays: plan.maxDoubleDays,
      hoursIntent: plan.hoursIntent,
      workoutStyle: plan.workoutStyle,
      targetWeeklyHours: plan.targetWeeklyHours,
      preferredRestWeekday: plan.preferredRestWeekday,
      suggestFtpTest: plan.suggestFtpTest,
      suggestBeepTest: plan.suggestBeepTest,
      suggestRunLthrTest: plan.suggestRunLthrTest,
    };
  }
  return {
    buildPace: "",
    maxRunSessions: 3,
    maxRideSessions: 2,
    maxDoubleDays: 0,
    hoursIntent: "keep",
    workoutStyle: "hours",
    targetWeeklyHours: suggestedTargetHours(avgHours, "keep"),
    preferredRestWeekday: 0,
    suggestFtpTest: true,
    suggestBeepTest: true,
    suggestRunLthrTest: true,
  };
}

function parseDraft(draft: TrainingDraft, timeZone: string) {
  return trainingPlanSchema.safeParse({
    buildPace: draft.buildPace || undefined,
    maxRunSessions: draft.maxRunSessions,
    maxRideSessions: draft.maxRideSessions,
    maxDoubleDays: draft.maxDoubleDays,
    hoursIntent: draft.hoursIntent,
    workoutStyle: draft.workoutStyle,
    targetWeeklyHours: draft.targetWeeklyHours,
    preferredRestWeekday: draft.preferredRestWeekday,
    suggestFtpTest: draft.suggestFtpTest,
    suggestBeepTest: draft.suggestBeepTest,
    suggestRunLthrTest: draft.suggestRunLthrTest,
    timeZone,
  });
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
  const locked = !data || !isTrainingPlanComplete(data.training);
  const [section, setSection] = useState<SettingsSection>("training");
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
  const [fieldErrors, setFieldErrors] = useState<{ weight?: string; height?: string }>({});
  const [trainingError, setTrainingError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    setSection(isTrainingPlanComplete(data.training) ? "profile" : "training");
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

  const age = ageFromBirthDate(profile.birthDate);
  const birth = profile.birthDate ? parseBirthDate(profile.birthDate) : null;
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
  const hoursMax = Math.min(
    30,
    Math.max(12, Math.ceil((avgHours || 5) * 1.5), draft.targetWeeklyHours),
  );

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
      if (isTrainingPlanComplete(saved.training)) onOpenChange(false);
    },
    onError: (caught) => {
      setSaveError(caught instanceof Error ? caught.message : "Could not save settings");
    },
  });

  function submit() {
    const weightKg = optionalNumber(weightInput);
    const heightCm = optionalNumber(heightInput);
    const nextErrors: { weight?: string; height?: string } = {};
    if (Number.isNaN(weightKg) || (weightKg != null && (weightKg < 20 || weightKg > 250))) {
      nextErrors.weight = "Enter a weight between 20 and 250 kg.";
    }
    if (
      Number.isNaN(heightCm) ||
      (heightCm != null && (!Number.isInteger(heightCm) || heightCm < 80 || heightCm > 250))
    ) {
      nextErrors.height = "Enter a whole height between 80 and 250 cm.";
    }
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
        profile: { birthDate: profile.birthDate, weightKg, heightCm },
        sportTypes,
        sportGroupShares,
        training: parsedTraining.data,
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!locked}
        className="flex h-[min(40rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {locked
              ? "Set your fitness goal and weekly sessions before using the calendar."
              : "Profile, training goal, and sport types used across calendar, map, fitness, and heart rate."}
          </DialogDescription>
        </DialogHeader>
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
                disabled={locked && item.id === "profile"}
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
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                      <Input id="settings-name" value={userName} disabled />
                      <FieldDescription>From your Strava account.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="settings-birth">Birthday</FieldLabel>
                      <div className="flex flex-wrap items-center gap-2">
                        <Popover>
                          <PopoverTrigger
                            render={
                              <Button
                                id="settings-birth"
                                type="button"
                                variant="outline"
                                className="min-w-48 justify-start font-normal"
                              />
                            }
                          >
                            <CalendarIcon data-icon="inline-start" />
                            {birth ? format(birth, "MMM d, yyyy") : "Pick a date"}
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-auto p-2">
                            <Calendar
                              mode="single"
                              captionLayout="dropdown"
                              selected={birth ?? undefined}
                              defaultMonth={birth ?? new Date(1990, 0)}
                              startMonth={new Date(1926, 0)}
                              endMonth={new Date()}
                              disabled={{ after: new Date() }}
                              onSelect={(next) => {
                                setProfile((current) => ({
                                  ...current,
                                  birthDate: next ? formatBirthDate(next) : null,
                                }));
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                        {age != null ? (
                          <Badge variant="secondary">{age} years old</Badge>
                        ) : (
                          <Badge variant="outline">Age unknown</Badge>
                        )}
                        {profile.birthDate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setProfile((current) => ({ ...current, birthDate: null }))
                            }
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      <FieldDescription>
                        Used later for age-graded analysis. Age updates from this date.
                      </FieldDescription>
                    </Field>
                    <Field data-invalid={Boolean(fieldErrors.weight)}>
                      <FieldLabel htmlFor="settings-weight">Weight</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="settings-weight"
                          type="number"
                          inputMode="decimal"
                          min={20}
                          max={250}
                          step="0.1"
                          placeholder="72"
                          value={weightInput}
                          aria-invalid={Boolean(fieldErrors.weight)}
                          onChange={(event) => setWeightInput(event.currentTarget.value)}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>
                            <WeightIcon />
                            kg
                          </InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {fieldErrors.weight ? <FieldError>{fieldErrors.weight}</FieldError> : null}
                    </Field>
                    <Field data-invalid={Boolean(fieldErrors.height)}>
                      <FieldLabel htmlFor="settings-height">Height</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="settings-height"
                          type="number"
                          inputMode="numeric"
                          min={80}
                          max={250}
                          step="1"
                          placeholder="178"
                          value={heightInput}
                          aria-invalid={Boolean(fieldErrors.height)}
                          onChange={(event) => setHeightInput(event.currentTarget.value)}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>
                            <RulerIcon />
                            cm
                          </InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {fieldErrors.height ? <FieldError>{fieldErrors.height}</FieldError> : null}
                    </Field>
                  </FieldGroup>
                ) : section === "training" ? (
                  <FieldGroup>
                    {locked ? (
                      <Alert variant="warning">
                        <TargetIcon />
                        <AlertTitle>Training goal required</AlertTitle>
                        <AlertDescription>
                          Tell us how you want to build fitness, how many sessions you can do, and
                          your preferred rest day. Then you can fill a weekly bucket on the
                          calendar.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <FieldSet data-invalid={Boolean(!draft.buildPace && trainingError)}>
                      <FieldLegend>Fitness and form</FieldLegend>
                      <FieldDescription>
                        Keep building, or hold where you are. Faster ramps raise fitness quicker and
                        sit you in more fatigue.
                      </FieldDescription>
                      <RadioGroup
                        value={draft.buildPace || undefined}
                        onValueChange={(next) => {
                          if (!next) return;
                          setDraft((current) => ({ ...current, buildPace: next as BuildPace }));
                          setTrainingError(null);
                        }}
                        className="gap-2"
                      >
                        {BUILD_PACES.map((pace) => {
                          const id = `training-pace-${pace.id}`;
                          return (
                            <FieldLabel key={pace.id} htmlFor={id} className="w-full">
                              <Field
                                orientation="horizontal"
                                className="items-start rounded-lg border p-3"
                              >
                                <RadioGroupItem value={pace.id} id={id} />
                                <FieldContent>
                                  <FieldTitle>{pace.label}</FieldTitle>
                                  <FieldDescription>{pace.hint}</FieldDescription>
                                </FieldContent>
                                <Badge
                                  variant={pace.id === "overreach" ? "destructive" : "outline"}
                                >
                                  {pace.risk}
                                </Badge>
                              </Field>
                            </FieldLabel>
                          );
                        })}
                      </RadioGroup>
                      {!draft.buildPace && trainingError ? (
                        <FieldError>{trainingError}</FieldError>
                      ) : null}
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLegend>Weekly sessions</FieldLegend>
                      <FieldDescription>
                        Caps for suggested run and ride sessions in the weekly bucket. Other sports
                        still count toward load.
                      </FieldDescription>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="training-max-run">Max runs</FieldLabel>
                          <Select
                            value={String(draft.maxRunSessions)}
                            onValueChange={(next) => {
                              if (next == null) return;
                              setDraft((current) => ({
                                ...current,
                                maxRunSessions: Number(next),
                              }));
                            }}
                          >
                            <SelectTrigger id="training-max-run">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {SESSION_COUNTS.map((count) => (
                                  <SelectItem key={count} value={String(count)}>
                                    {count} {count === 1 ? "run" : "runs"}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="training-max-ride">Max rides</FieldLabel>
                          <Select
                            value={String(draft.maxRideSessions)}
                            onValueChange={(next) => {
                              if (next == null) return;
                              setDraft((current) => ({
                                ...current,
                                maxRideSessions: Number(next),
                              }));
                            }}
                          >
                            <SelectTrigger id="training-max-ride">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {SESSION_COUNTS.map((count) => (
                                  <SelectItem key={count} value={String(count)}>
                                    {count} {count === 1 ? "ride" : "rides"}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel htmlFor="training-double-days">
                          Days with two sessions
                        </FieldLabel>
                        <Select
                          value={String(draft.maxDoubleDays)}
                          onValueChange={(next) => {
                            if (next == null) return;
                            setDraft((current) => ({
                              ...current,
                              maxDoubleDays: Number(next),
                            }));
                          }}
                        >
                          <SelectTrigger id="training-double-days">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {DOUBLE_DAY_COUNTS.map((count) => (
                                <SelectItem key={count} value={String(count)}>
                                  {count === 0 ? "None" : count === 1 ? "1 day" : `${count} days`}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          How many days you are OK stacking a ride and a run. The bucket does not
                          assign those days — you pick when to double up.
                        </FieldDescription>
                      </Field>
                    </FieldSet>
                    <FieldSet>
                      <FieldLegend>Weekly hours</FieldLegend>
                      <FieldDescription>
                        Your last 3 months average{" "}
                        {avgHours > 0.2 ? formatHours(avgHours) : "is still thin"}. Choose whether
                        to cut back, keep that volume, or add hours.
                      </FieldDescription>
                      <RadioGroup
                        value={draft.hoursIntent}
                        onValueChange={(next) => {
                          if (!next) return;
                          const intent = next as HoursIntent;
                          setDraft((current) => ({
                            ...current,
                            hoursIntent: intent,
                            targetWeeklyHours: suggestedTargetHours(avgHours, intent),
                          }));
                        }}
                      >
                        {HOURS_INTENTS.map((intent) => {
                          const id = `training-hours-${intent.id}`;
                          return (
                            <Field key={intent.id} orientation="horizontal">
                              <RadioGroupItem value={intent.id} id={id} />
                              <FieldLabel htmlFor={id} className="font-normal">
                                {intent.label}
                              </FieldLabel>
                            </Field>
                          );
                        })}
                      </RadioGroup>
                      <Field data-invalid={!consistency.ok}>
                        <FieldLabel htmlFor="training-hours-slider">
                          Target {formatHours(draft.targetWeeklyHours)} a week
                        </FieldLabel>
                        <Slider
                          id="training-hours-slider"
                          min={0.5}
                          max={hoursMax}
                          step={0.5}
                          value={[draft.targetWeeklyHours]}
                          onValueChange={(next) => {
                            const value = Array.isArray(next) ? next[0] : next;
                            if (typeof value !== "number") return;
                            setDraft((current) => ({ ...current, targetWeeklyHours: value }));
                          }}
                        />
                        {!consistency.ok && consistency.message ? (
                          <FieldError>{consistency.message}</FieldError>
                        ) : (
                          <FieldDescription>
                            Kept in range with {draft.maxRunSessions + draft.maxRideSessions} run
                            and ride sessions.
                          </FieldDescription>
                        )}
                      </Field>
                    </FieldSet>
                    <FieldSet>
                      <FieldLegend>Suggested sessions</FieldLegend>
                      <FieldDescription>
                        Hours of training keeps the weekly bucket as easy aerobic volume. Intervals
                        and zones add threshold, VO2, and tempo when form allows — watts if that
                        sport has a power meter, heart rate if it has a belt or watch, otherwise
                        RPE.
                      </FieldDescription>
                      <RadioGroup
                        value={draft.workoutStyle}
                        onValueChange={(next) => {
                          if (!next) return;
                          setDraft((current) => ({
                            ...current,
                            workoutStyle: next as WorkoutStyle,
                          }));
                        }}
                        className="gap-2"
                      >
                        {WORKOUT_STYLES.map((style) => {
                          const id = `training-style-${style.id}`;
                          return (
                            <FieldLabel key={style.id} htmlFor={id} className="w-full">
                              <Field
                                orientation="horizontal"
                                className="items-start rounded-lg border p-3"
                              >
                                <RadioGroupItem value={style.id} id={id} />
                                <FieldContent>
                                  <FieldTitle>{style.label}</FieldTitle>
                                  <FieldDescription>{style.hint}</FieldDescription>
                                </FieldContent>
                              </Field>
                            </FieldLabel>
                          );
                        })}
                      </RadioGroup>
                      {draft.workoutStyle === "structured" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() => setSection("sports")}
                        >
                          Set collectors per sport
                        </Button>
                      ) : null}
                    </FieldSet>
                    <FieldSet>
                      <FieldLegend>Preferred rest day</FieldLegend>
                      <FieldDescription>
                        A reminder in the weekly bucket. Workouts are not pinned to other days, so
                        you can still train here if that is when you have time.
                      </FieldDescription>
                      <ToggleGroup
                        size="sm"
                        variant="outline"
                        spacing={0}
                        value={[String(draft.preferredRestWeekday)]}
                        onValueChange={(next) => {
                          const value = next[0];
                          if (value == null) return;
                          setDraft((current) => ({
                            ...current,
                            preferredRestWeekday: Number(value),
                          }));
                        }}
                        className="flex-wrap"
                      >
                        {WEEKDAYS.map((day) => (
                          <ToggleGroupItem key={day.id} value={String(day.id)}>
                            {day.label.slice(0, 3)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLegend>Field tests</FieldLegend>
                      <FieldDescription>
                        Published field tests for FTP, VO2max, and lactate-threshold HR. They live
                        on Tests, not in the weekly bucket. Turn off any you do not want suggested.
                      </FieldDescription>
                      <Field orientation="horizontal">
                        <Switch
                          id="training-ftp-test"
                          checked={draft.suggestFtpTest}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({ ...current, suggestFtpTest: checked }))
                          }
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="training-ftp-test" className="font-normal">
                            FTP 20-min
                          </FieldLabel>
                          <FieldDescription>
                            Allen & Coggan. About 1h 15. FTP = 95% of 20-min power.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <Switch
                          id="training-beep-test"
                          checked={draft.suggestBeepTest}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({ ...current, suggestBeepTest: checked }))
                          }
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="training-beep-test" className="font-normal">
                            Beep test
                          </FieldLabel>
                          <FieldDescription>
                            Léger 20 m shuttle. Stage speed estimates VO2max; peak HR is run max HR.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <Switch
                          id="training-run-lthr"
                          checked={draft.suggestRunLthrTest}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({ ...current, suggestRunLthrTest: checked }))
                          }
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="training-run-lthr" className="font-normal">
                            Run LTHR
                          </FieldLabel>
                          <FieldDescription>
                            Friel 30-min solo time trial. Last 20 min average HR is run threshold.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldSet>
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
        <DialogFooter className="border-t px-4 py-3">
          {saveError ? <p className="text-destructive me-auto text-xs">{saveError}</p> : null}
          {locked ? null : (
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          )}
          <Button type="button" disabled={save.isPending} onClick={submit}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
