"use client";

import { format } from "date-fns";
import { CalendarIcon, RulerIcon, WeightIcon } from "lucide-react";

import {
  ageFromBirthDate,
  formatBirthDate,
  parseBirthDate,
  type ProfileSettings,
} from "#/services/app-settings.ts";
import {
  BUILD_PACES,
  HOURS_INTENTS,
  WEEKDAYS,
  WORKOUT_STYLES,
  formatHours,
  suggestedTargetHours,
  trainingConsistency,
  trainingPlanSchema,
  type BuildPace,
  type HoursIntent,
  type TrainingPlan,
  type WorkoutStyle,
} from "#/services/training-plan.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TrainingDraft = {
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

export type ProfileFieldErrors = { weight?: string; height?: string };

export const SESSION_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7];
export const DOUBLE_DAY_COUNTS = [0, 1, 2, 3, 4, 5, 6];

export function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function draftFromPlan(plan: TrainingPlan | null, avgHours: number): TrainingDraft {
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

export function parseDraft(draft: TrainingDraft, timeZone: string) {
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

export function validateProfileInputs(
  weightInput: string,
  heightInput: string,
): ProfileFieldErrors {
  const weightKg = optionalNumber(weightInput);
  const heightCm = optionalNumber(heightInput);
  const nextErrors: ProfileFieldErrors = {};
  if (Number.isNaN(weightKg) || (weightKg != null && (weightKg < 20 || weightKg > 250))) {
    nextErrors.weight = "Enter a weight between 20 and 250 kg.";
  }
  if (
    Number.isNaN(heightCm) ||
    (heightCm != null && (!Number.isInteger(heightCm) || heightCm < 80 || heightCm > 250))
  ) {
    nextErrors.height = "Enter a whole height between 80 and 250 cm.";
  }
  return nextErrors;
}

export function ProfileFields({
  idPrefix,
  userName,
  profile,
  setProfile,
  weightInput,
  setWeightInput,
  heightInput,
  setHeightInput,
  fieldErrors,
}: {
  idPrefix: string;
  userName: string;
  profile: ProfileSettings;
  setProfile: (next: ProfileSettings | ((current: ProfileSettings) => ProfileSettings)) => void;
  weightInput: string;
  setWeightInput: (value: string) => void;
  heightInput: string;
  setHeightInput: (value: string) => void;
  fieldErrors: ProfileFieldErrors;
}) {
  const age = ageFromBirthDate(profile.birthDate);
  const birth = profile.birthDate ? parseBirthDate(profile.birthDate) : null;
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
        <Input id={`${idPrefix}-name`} value={userName} disabled />
        <FieldDescription>From your Strava account.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-birth`}>Birthday</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  id={`${idPrefix}-birth`}
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
              onClick={() => setProfile((current) => ({ ...current, birthDate: null }))}
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
        <FieldLabel htmlFor={`${idPrefix}-weight`}>Weight</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-weight`}
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
        <FieldLabel htmlFor={`${idPrefix}-height`}>Height</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-height`}
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
  );
}

export function TrainingPaceFields({
  idPrefix,
  draft,
  setDraft,
  trainingError,
}: {
  idPrefix: string;
  draft: TrainingDraft;
  setDraft: (next: TrainingDraft | ((current: TrainingDraft) => TrainingDraft)) => void;
  trainingError: string | null;
}) {
  return (
    <FieldSet data-invalid={Boolean(!draft.buildPace && trainingError)}>
      <FieldLegend>Fitness and form</FieldLegend>
      <FieldDescription>
        Keep building, or hold where you are. Faster ramps raise fitness quicker and sit you in more
        fatigue.
      </FieldDescription>
      <RadioGroup
        value={draft.buildPace || undefined}
        onValueChange={(next) => {
          if (!next) return;
          setDraft((current) => ({ ...current, buildPace: next as BuildPace }));
        }}
        className="gap-2"
      >
        {BUILD_PACES.map((pace) => {
          const id = `${idPrefix}-pace-${pace.id}`;
          return (
            <FieldLabel key={pace.id} htmlFor={id} className="w-full">
              <Field orientation="horizontal" className="items-start rounded-lg border p-3">
                <RadioGroupItem value={pace.id} id={id} />
                <FieldContent>
                  <FieldTitle>{pace.label}</FieldTitle>
                  <FieldDescription>{pace.hint}</FieldDescription>
                </FieldContent>
                <Badge variant={pace.id === "overreach" ? "destructive" : "outline"}>
                  {pace.risk}
                </Badge>
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>
      {!draft.buildPace && trainingError ? <FieldError>{trainingError}</FieldError> : null}
    </FieldSet>
  );
}

export function TrainingWeekFields({
  idPrefix,
  draft,
  setDraft,
  avgHours,
}: {
  idPrefix: string;
  draft: TrainingDraft;
  setDraft: (next: TrainingDraft | ((current: TrainingDraft) => TrainingDraft)) => void;
  avgHours: number;
}) {
  const parsed = parseDraft(draft, "UTC");
  const consistency = parsed.success
    ? trainingConsistency(parsed.data)
    : { ok: false, message: draft.buildPace ? null : "Choose how hard you want to build fitness." };
  const hoursMax = Math.min(
    30,
    Math.max(12, Math.ceil((avgHours || 5) * 1.5), draft.targetWeeklyHours),
  );
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Weekly sessions</FieldLegend>
        <FieldDescription>
          Caps for suggested run and ride sessions in the weekly bucket. Other sports still count
          toward load.
        </FieldDescription>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-max-run`}>Max runs</FieldLabel>
            <Select
              value={String(draft.maxRunSessions)}
              onValueChange={(next) => {
                if (next == null) return;
                setDraft((current) => ({ ...current, maxRunSessions: Number(next) }));
              }}
            >
              <SelectTrigger id={`${idPrefix}-max-run`}>
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
            <FieldLabel htmlFor={`${idPrefix}-max-ride`}>Max rides</FieldLabel>
            <Select
              value={String(draft.maxRideSessions)}
              onValueChange={(next) => {
                if (next == null) return;
                setDraft((current) => ({ ...current, maxRideSessions: Number(next) }));
              }}
            >
              <SelectTrigger id={`${idPrefix}-max-ride`}>
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
          <FieldLabel htmlFor={`${idPrefix}-double-days`}>Days with two sessions</FieldLabel>
          <Select
            value={String(draft.maxDoubleDays)}
            onValueChange={(next) => {
              if (next == null) return;
              setDraft((current) => ({ ...current, maxDoubleDays: Number(next) }));
            }}
          >
            <SelectTrigger id={`${idPrefix}-double-days`}>
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
            How many days you are OK stacking a ride and a run. The bucket does not assign those
            days — you pick when to double up.
          </FieldDescription>
        </Field>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Weekly hours</FieldLegend>
        <FieldDescription>
          Your last 3 months average {avgHours > 0.2 ? formatHours(avgHours) : "is still thin"}.
          Choose whether to cut back, keep that volume, or add hours.
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
            const id = `${idPrefix}-hours-${intent.id}`;
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
          <FieldLabel htmlFor={`${idPrefix}-hours-slider`}>
            Target {formatHours(draft.targetWeeklyHours)} a week
          </FieldLabel>
          <Slider
            id={`${idPrefix}-hours-slider`}
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
              Kept in range with {draft.maxRunSessions + draft.maxRideSessions} run and ride
              sessions.
            </FieldDescription>
          )}
        </Field>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Preferred rest day</FieldLegend>
        <FieldDescription>
          A reminder in the weekly bucket. Workouts are not pinned to other days, so you can still
          train here if that is when you have time.
        </FieldDescription>
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          value={[String(draft.preferredRestWeekday)]}
          onValueChange={(next) => {
            const value = next[0];
            if (value == null) return;
            setDraft((current) => ({ ...current, preferredRestWeekday: Number(value) }));
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
    </FieldGroup>
  );
}

export function TrainingStyleFields({
  idPrefix,
  draft,
  setDraft,
  onOpenSports,
}: {
  idPrefix: string;
  draft: TrainingDraft;
  setDraft: (next: TrainingDraft | ((current: TrainingDraft) => TrainingDraft)) => void;
  onOpenSports?: () => void;
}) {
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Suggested sessions</FieldLegend>
        <FieldDescription>
          Hours of training keeps the weekly bucket as easy aerobic volume. Intervals and zones add
          threshold, VO2, and tempo when form allows — watts if that sport has a power meter, heart
          rate if it has a belt or watch, otherwise RPE.
        </FieldDescription>
        <RadioGroup
          value={draft.workoutStyle}
          onValueChange={(next) => {
            if (!next) return;
            setDraft((current) => ({ ...current, workoutStyle: next as WorkoutStyle }));
          }}
          className="gap-2"
        >
          {WORKOUT_STYLES.map((style) => {
            const id = `${idPrefix}-style-${style.id}`;
            return (
              <FieldLabel key={style.id} htmlFor={id} className="w-full">
                <Field orientation="horizontal" className="items-start rounded-lg border p-3">
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
        {draft.workoutStyle === "structured" && onOpenSports ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={onOpenSports}
          >
            Set collectors per sport
          </Button>
        ) : null}
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Field tests</FieldLegend>
        <FieldDescription>
          Published field tests for FTP, VO2max, and lactate-threshold HR. They live on Tests, not
          in the weekly bucket. Turn off any you do not want suggested.
        </FieldDescription>
        <Field orientation="horizontal">
          <Switch
            id={`${idPrefix}-ftp-test`}
            checked={draft.suggestFtpTest}
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, suggestFtpTest: checked }))
            }
          />
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-ftp-test`} className="font-normal">
              FTP 20-min
            </FieldLabel>
            <FieldDescription>
              Allen & Coggan. About 1h 15. FTP = 95% of 20-min power.
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id={`${idPrefix}-beep-test`}
            checked={draft.suggestBeepTest}
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, suggestBeepTest: checked }))
            }
          />
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-beep-test`} className="font-normal">
              Beep test
            </FieldLabel>
            <FieldDescription>
              Léger 20 m shuttle. Stage speed estimates VO2max; peak HR is run max HR.
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id={`${idPrefix}-run-lthr`}
            checked={draft.suggestRunLthrTest}
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, suggestRunLthrTest: checked }))
            }
          />
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-run-lthr`} className="font-normal">
              Run LTHR
            </FieldLabel>
            <FieldDescription>
              Friel 30-min solo time trial. Last 20 min average HR is run threshold.
            </FieldDescription>
          </FieldContent>
        </Field>
      </FieldSet>
    </FieldGroup>
  );
}
