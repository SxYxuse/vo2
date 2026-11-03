"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, WeightIcon } from "lucide-react";
import { Controller, useWatch, type Control, type FieldPath } from "react-hook-form";

import {
  ageFromBirthDate,
  CALENDAR_PERIODS,
  formatBirthDate,
  parseBirthDate,
  PLANNING_STYLES,
  planningStyleSchema,
  type PlanningStyle,
} from "@/services/athlete-settings.types.ts";
import type { ProfileFormValues, SettingsFormInput } from "@/lib/settings-form.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Controller
      name={"birthDate" as FieldPath<T>}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`${idPrefix}-birth`}>Birthday</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
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
                    if (!next) return;
                    field.onChange(formatBirthDate(next));
                    // Picking the day finishes the field; on a phone the open calendar would
                    // otherwise cover the step's Continue button.
                    setPickerOpen(false);
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
          <FieldDescription>Used for watts per kilogram on your personal bests.</FieldDescription>
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** Settings → Training: the week's shape, saved as the athlete edits it (ADR 0026). */
/** The coach plan or off (ADR 0050). */
export function PlanningStyleChoice({
  idPrefix,
  value,
  onChange,
  disabled = false,
  titled = true,
}: {
  idPrefix: string;
  value: PlanningStyle;
  onChange: (next: PlanningStyle) => void;
  disabled?: boolean;
  /** False where the page heading already names the choice, as in onboarding. */
  titled?: boolean;
}) {
  return (
    <FieldSet>
      <FieldLegend className={titled ? undefined : "sr-only"}>Planning style</FieldLegend>
      {titled ? (
        <FieldDescription>
          How VO2 plans your training. Turning planning off keeps the coach plan's setup, so you can
          come back to it.
        </FieldDescription>
      ) : null}
      <RadioGroup
        name="planningStyle"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const parsed = planningStyleSchema.safeParse(next);
          if (parsed.success) onChange(parsed.data);
        }}
        className="gap-2"
      >
        {PLANNING_STYLES.map((style) => {
          const id = `${idPrefix}-planning-style-${style.id}`;
          return (
            <FieldLabel key={style.id} htmlFor={id} className="w-full">
              <Field orientation="horizontal" className="items-start p-3">
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
    </FieldSet>
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
                  <Field orientation="horizontal" className="items-start p-3">
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

export function CelebrateTopEffortsField({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<SettingsFormInput>;
}) {
  const id = `${idPrefix}-celebrate-top-efforts`;
  return (
    <Controller
      name="celebrateTopEfforts"
      control={control}
      render={({ field }) => (
        <Field orientation="horizontal" className="items-start">
          <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />
          <FieldContent>
            <FieldLabel htmlFor={id}>Celebrate top 10 efforts</FieldLabel>
            <FieldDescription>
              When a new activity from the last 7 days ranks in your top 10, all time or this year,
              VO2 shows it the next time you open the app. Only activities synced after you turn
              this on count.
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    />
  );
}
