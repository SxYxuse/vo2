"use client";

import { format } from "date-fns";
import { CalendarIcon, WeightIcon } from "lucide-react";
import {
  Controller,
  useWatch,
  type Control,
  type FieldPath,
  type UseFormSetValue,
} from "react-hook-form";

import {
  ageFromBirthDate,
  CALENDAR_PERIODS,
  formatBirthDate,
  parseBirthDate,
} from "@/services/athlete-settings.types.ts";
import {
  BUILD_PACES,
  HOURS_INTENTS,
  TARGET_MODES,
  WEEKDAYS,
  formatHours,
  hasRecentWeeklyHours,
  suggestedTargetHours,
  type HoursIntent,
} from "@/services/training-plan.ts";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
      <WeightField idPrefix={idPrefix} control={control} />
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

export function WeightField<T extends ProfileFormValues>({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<T>;
}) {
  return (
    <Controller
      name={"weightKg" as FieldPath<T>}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`${idPrefix}-weight`}>Weight</FieldLabel>
          <InputGroup className="max-w-48">
            {/* Text, not number: comma-decimal keyboards can't type "72.5" into a number input. */}
            <InputGroupInput
              id={`${idPrefix}-weight`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="72"
              name={field.name}
              value={field.value as string}
              aria-invalid={fieldState.invalid}
              onBlur={field.onBlur}
              onChange={field.onChange}
              ref={field.ref}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>
                <WeightIcon />
                kg
              </InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>Caps the caffeine in your fuel plans.</FieldDescription>
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
  const targetMode = useWatch({ control, name: "targetMode" as FieldPath<T> }) as string;
  const hoursMax = Math.min(30, Math.max(12, Math.ceil((avgHours || 5) * 1.5)));
  const hasHistory = hasRecentWeeklyHours(avgHours);
  const showHours = targetMode === "manual" || !hasHistory;

  return (
    <FieldGroup>
      <Controller
        name={"targetMode" as FieldPath<T>}
        control={control}
        render={({ field, fieldState }) => (
          <FieldSet data-invalid={fieldState.invalid}>
            <FieldLegend>Weekly target</FieldLegend>
            <FieldDescription>
              Hours are the headline on the Week target page. Training load follows your build pace
              either way.
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
              {TARGET_MODES.map((mode) => {
                const id = `${idPrefix}-target-${mode.id}`;
                return (
                  <FieldLabel key={mode.id} htmlFor={id} className="w-full">
                    <Field orientation="horizontal" className="items-start rounded-lg border p-3">
                      <RadioGroupItem value={mode.id} id={id} />
                      <FieldContent>
                        <FieldTitle>{mode.label}</FieldTitle>
                        <FieldDescription>{mode.hint}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                );
              })}
            </RadioGroup>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </FieldSet>
        )}
      />
      {showHours ? (
        <FieldSet>
          <FieldLegend>{targetMode === "manual" ? "Weekly hours" : "Starting hours"}</FieldLegend>
          <FieldDescription>
            {targetMode !== "manual"
              ? "No recent history yet. VO2 uses these hours until it can set the target from your fitness."
              : hasHistory
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
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${idPrefix}-hours-slider`}>
                  Target {formatHours(field.value as number)} a week
                </FieldLabel>
                <Slider
                  id={`${idPrefix}-hours-slider`}
                  min={0.5}
                  max={Math.max(hoursMax, field.value as number)}
                  step={0.5}
                  value={[field.value as number]}
                  onValueChange={(next) => {
                    const value = Array.isArray(next) ? next[0] : next;
                    if (typeof value !== "number") return;
                    field.onChange(value);
                  }}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </FieldSet>
      ) : null}
      <Controller
        name={"preferredRestWeekday" as FieldPath<T>}
        control={control}
        render={({ field, fieldState }) => (
          <FieldSet data-invalid={fieldState.invalid}>
            <FieldLegend>Preferred rest day</FieldLegend>
            <FieldDescription>
              Left out when the remaining time is spread over the week. You can still train that day
              if it is when you have time.
            </FieldDescription>
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={0}
              value={[String(field.value as number)]}
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
