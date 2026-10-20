"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import {
  Controller,
  useWatch,
  type Control,
  type FieldPath,
  type UseFormSetValue,
} from "react-hook-form";

import { ageFromBirthDate, formatBirthDate, parseBirthDate } from "@/services/app-settings.ts";
import {
  BUILD_PACES,
  HOURS_INTENTS,
  WEEKDAYS,
  WORKOUT_STYLES,
  formatHours,
  hasRecentWeeklyHours,
  suggestedTargetHours,
  trainingConsistency,
  type HoursIntent,
} from "@/services/training-plan.ts";
import { CALENDAR_PERIODS } from "@/services/calendar-settings.ts";
import type {
  ProfileFormValues,
  SettingsFormInput,
  TrainingFormInput,
} from "@/lib/settings-form.ts";
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
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const SESSION_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7];
export const DOUBLE_DAY_COUNTS = [0, 1, 2, 3, 4, 5, 6];

export function ProfileFields<T extends ProfileFormValues>({
  idPrefix,
  userName,
  control,
}: {
  idPrefix: string;
  userName: string;
  control: Control<T>;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
        <Input id={`${idPrefix}-name`} value={userName} disabled />
        <FieldDescription>From your Strava account.</FieldDescription>
      </Field>
      <BirthDateField idPrefix={idPrefix} control={control} />
    </FieldGroup>
  );
}

export function BirthDateField<T extends ProfileFormValues>({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<T>;
}) {
  const birthDate = useWatch({ control, name: "birthDate" as FieldPath<T> }) as string | null;
  const age = ageFromBirthDate(birthDate);
  const birth = birthDate ? parseBirthDate(birthDate) : null;

  return (
    <Controller
      name={"birthDate" as FieldPath<T>}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
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
                    aria-invalid={fieldState.invalid}
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
                    if (next) field.onChange(formatBirthDate(next));
                  }}
                />
              </PopoverContent>
            </Popover>
            {age != null ? <Badge variant="secondary">{age} years old</Badge> : null}
          </div>
          <FieldDescription>
            Your age predicts your max heart rate, which sets heart-rate zones and training load.
          </FieldDescription>
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export function TrainingPaceFields<T extends TrainingFormInput>({
  idPrefix,
  control,
  hasActivityHistory = true,
}: {
  idPrefix: string;
  control: Control<T>;
  hasActivityHistory?: boolean;
}) {
  return (
    <Controller
      name={"buildPace" as FieldPath<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldSet data-invalid={fieldState.invalid}>
          <FieldLegend>Fitness and form</FieldLegend>
          <FieldDescription>
            {hasActivityHistory
              ? "Keep building, or hold where you are. Faster ramps raise fitness quicker and sit you in more fatigue."
              : "How hard this block should push. After activities are copied, faster ramps raise fitness quicker and sit you in more fatigue."}
          </FieldDescription>
          <RadioGroup
            name={field.name}
            value={(field.value as string) || null}
            onValueChange={(next) => {
              if (!next) return;
              field.onChange(next);
            }}
            className="gap-2"
          >
            {BUILD_PACES.map((pace) => {
              const id = `${idPrefix}-pace-${pace.id}`;
              return (
                <FieldLabel key={pace.id} htmlFor={id} className="w-full">
                  <Field
                    orientation="horizontal"
                    className="items-start rounded-lg border p-3"
                    data-invalid={fieldState.invalid}
                  >
                    <RadioGroupItem value={pace.id} id={id} aria-invalid={fieldState.invalid} />
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
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </FieldSet>
      )}
    />
  );
}

export function TrainingDoubleDaysField<T extends TrainingFormInput>({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<T>;
}) {
  return (
    <Controller
      name={"maxDoubleDays" as FieldPath<T>}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`${idPrefix}-double-days`}>Days with two sessions</FieldLabel>
          <Select
            value={String(field.value)}
            onValueChange={(next) => {
              if (next == null) return;
              field.onChange(Number(next));
            }}
          >
            <SelectTrigger id={`${idPrefix}-double-days`} aria-invalid={fieldState.invalid}>
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
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export function TrainingWeekFields<T extends TrainingFormInput>({
  idPrefix,
  control,
  setValue,
  avgHours,
}: {
  idPrefix: string;
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  avgHours: number;
}) {
  const maxRunSessions = useWatch({
    control,
    name: "maxRunSessions" as FieldPath<T>,
  }) as number;
  const maxRideSessions = useWatch({
    control,
    name: "maxRideSessions" as FieldPath<T>,
  }) as number;
  const targetWeeklyHours = useWatch({
    control,
    name: "targetWeeklyHours" as FieldPath<T>,
  }) as number;
  const consistency = trainingConsistency({
    maxRunSessions,
    maxRideSessions,
    targetWeeklyHours,
  });
  const hoursMax = Math.min(30, Math.max(12, Math.ceil((avgHours || 5) * 1.5), targetWeeklyHours));
  const hasHistory = hasRecentWeeklyHours(avgHours);

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Weekly sessions</FieldLegend>
        <FieldDescription>
          {hasHistory
            ? "Caps for suggested run and ride sessions in the week bucket. Other sports still count toward load."
            : "How many runs and rides to put in the week bucket each week. Other sports still count toward load once activities are copied."}
        </FieldDescription>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Controller
            name={"maxRunSessions" as FieldPath<T>}
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${idPrefix}-max-run`}>Max runs</FieldLabel>
                <Select
                  value={String(field.value)}
                  onValueChange={(next) => {
                    if (next == null) return;
                    field.onChange(Number(next));
                  }}
                >
                  <SelectTrigger id={`${idPrefix}-max-run`} aria-invalid={fieldState.invalid}>
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
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name={"maxRideSessions" as FieldPath<T>}
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${idPrefix}-max-ride`}>Max rides</FieldLabel>
                <Select
                  value={String(field.value)}
                  onValueChange={(next) => {
                    if (next == null) return;
                    field.onChange(Number(next));
                  }}
                >
                  <SelectTrigger id={`${idPrefix}-max-ride`} aria-invalid={fieldState.invalid}>
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
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Weekly hours</FieldLegend>
        <FieldDescription>
          {hasHistory
            ? `Your last 3 months average ${formatHours(avgHours)}. Choose whether to cut back, keep that volume, or add hours.`
            : "No activities copied from Strava yet, so there is no recent-weeks baseline. Choose how many hours you want to train each week."}
        </FieldDescription>
        {hasHistory ? (
          <Controller
            name={"hoursIntent" as FieldPath<T>}
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <RadioGroup
                  name={field.name}
                  value={field.value as string}
                  onValueChange={(next) => {
                    if (!next) return;
                    field.onChange(next);
                    setValue(
                      "targetWeeklyHours" as FieldPath<T>,
                      suggestedTargetHours(avgHours, next as HoursIntent) as never,
                      { shouldValidate: true },
                    );
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
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        ) : null}
        <Controller
          name={"targetWeeklyHours" as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || !consistency.ok}>
              <FieldLabel htmlFor={`${idPrefix}-hours-slider`}>
                Target {formatHours(field.value as number)} a week
              </FieldLabel>
              <Slider
                id={`${idPrefix}-hours-slider`}
                min={0.5}
                max={hoursMax}
                step={0.5}
                value={[field.value as number]}
                onValueChange={(next) => {
                  const value = Array.isArray(next) ? next[0] : next;
                  if (typeof value !== "number") return;
                  field.onChange(value);
                }}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : !consistency.ok && consistency.message ? (
                <FieldError>{consistency.message}</FieldError>
              ) : (
                <FieldDescription>
                  Kept in range with {maxRunSessions + maxRideSessions} run and ride sessions.
                </FieldDescription>
              )}
            </Field>
          )}
        />
      </FieldSet>
      <Controller
        name={"preferredRestWeekday" as FieldPath<T>}
        control={control}
        render={({ field, fieldState }) => (
          <FieldSet data-invalid={fieldState.invalid}>
            <FieldLegend>Preferred rest day</FieldLegend>
            <FieldDescription>
              A reminder in the weekly bucket. Workouts are not pinned to other days, so you can
              still train here if that is when you have time.
            </FieldDescription>
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={0}
              value={[String(field.value)]}
              onValueChange={(next) => {
                const value = next[0];
                if (value == null) return;
                field.onChange(Number(value));
              }}
              className="flex-wrap"
            >
              {WEEKDAYS.map((day) => (
                <ToggleGroupItem key={day.id} value={String(day.id)}>
                  {day.label.slice(0, 3)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </FieldSet>
        )}
      />
    </FieldGroup>
  );
}

export function TrainingStyleFields<T extends TrainingFormInput>({
  idPrefix,
  control,
  onOpenSports,
}: {
  idPrefix: string;
  control: Control<T>;
  onOpenSports?: () => void;
}) {
  const workoutStyle = useWatch({ control, name: "workoutStyle" as FieldPath<T> });

  return (
    <FieldGroup>
      <Controller
        name={"workoutStyle" as FieldPath<T>}
        control={control}
        render={({ field, fieldState }) => (
          <FieldSet data-invalid={fieldState.invalid}>
            <FieldLegend>Suggested sessions</FieldLegend>
            <FieldDescription>
              Hours of training keeps the weekly bucket as easy aerobic volume. Intervals and zones
              add threshold, VO2, and tempo when form allows — watts if that sport has a power
              meter, heart rate if it has a belt or watch, otherwise RPE.
            </FieldDescription>
            <RadioGroup
              name={field.name}
              value={field.value as string}
              onValueChange={(next) => {
                if (!next) return;
                field.onChange(next);
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
            {workoutStyle === "structured" && onOpenSports ? (
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
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </FieldSet>
        )}
      />
    </FieldGroup>
  );
}

export function CalendarPeriodField({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<SettingsFormInput>;
}) {
  return (
    <Controller
      name="calendarPeriod"
      control={control}
      render={({ field }) => (
        <FieldSet>
          <FieldLegend>Calendar period</FieldLegend>
          <FieldDescription>
            What the activity calendar shows on a wide screen. Previous and next move by that same
            period. Phones always show one training week.
          </FieldDescription>
          <RadioGroup
            name={field.name}
            value={field.value}
            onValueChange={(next) => {
              if (!next) return;
              field.onChange(next);
            }}
            className="gap-2"
          >
            {CALENDAR_PERIODS.map((period) => {
              const id = `${idPrefix}-calendar-period-${period.id}`;
              return (
                <FieldLabel key={period.id} htmlFor={id} className="w-full">
                  <Field orientation="horizontal" className="items-start rounded-lg border p-3">
                    <RadioGroupItem value={period.id} id={id} />
                    <FieldContent>
                      <FieldTitle>{period.label}</FieldTitle>
                      <FieldDescription>{period.hint}</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              );
            })}
          </RadioGroup>
        </FieldSet>
      )}
    />
  );
}
