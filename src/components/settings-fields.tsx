"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Link } from "@tanstack/react-router";
import { CalendarIcon, RefreshCwIcon, SparklesIcon, WeightIcon } from "lucide-react";
import { Controller, useController, useWatch, type Control, type FieldPath } from "react-hook-form";

import {
  ageFromBirthDate,
  CALENDAR_PERIODS,
  formatBirthDate,
  parseBirthDate,
} from "@/services/athlete-settings.types.ts";
import { mondayOf } from "@/services/season-phase.ts";
import {
  GOAL_OBJECTIVES,
  anchorEvent,
  daysBetween,
  eventTitle,
  formatDaysLeft,
  seasonEvents,
  type Goal,
} from "@/services/season.types.ts";
import type { KeySport, TrainingPlan, WeekShape } from "@/services/training-plan.types.ts";
import { WeekShapeFields } from "@/components/week-shape-fields.tsx";
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
          <FieldDescription>Caps the caffeine in your fuel plans.</FieldDescription>
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** Settings → Training: the week's shape, saved as the athlete edits it (ADR 0026). */
export function TrainingShapeField<T extends TrainingFormInput>({
  control,
}: {
  control: Control<T>;
}) {
  const rest = useController({ control, name: "restWeekdays" as FieldPath<T> });
  const long = useController({ control, name: "longWeekday" as FieldPath<T> });
  const doubles = useController({ control, name: "doubleDays" as FieldPath<T> });
  const sports = useController({ control, name: "sports" as FieldPath<T> });
  const value: WeekShape = {
    restWeekdays: rest.field.value as number[],
    longWeekday: long.field.value as number,
    doubleDays: doubles.field.value as number,
    sports: sports.field.value as KeySport[],
  };
  return (
    <WeekShapeFields
      value={value}
      onChange={(next) => {
        // One change event per field that moved, so the settings save sees each of them.
        if (JSON.stringify(next.restWeekdays) !== JSON.stringify(value.restWeekdays)) {
          rest.field.onChange(next.restWeekdays);
        }
        if (next.longWeekday !== value.longWeekday) long.field.onChange(next.longWeekday);
        if (next.doubleDays !== value.doubleDays) doubles.field.onChange(next.doubleDays);
        if (JSON.stringify(next.sports) !== JSON.stringify(value.sports)) {
          sports.field.onChange(next.sports);
        }
      }}
    />
  );
}

/** The plan at a glance, with the way to rebuild it. Without a plan, the way to build one. */
export function PlanSummary({ plan, today }: { plan: TrainingPlan | null; today: string }) {
  if (!plan || !plan.goals) {
    return (
      <FieldSet>
        <FieldLegend>Your plan</FieldLegend>
        <FieldDescription>
          {plan
            ? "Your plan was set up before the plan builder. Build it again to plan your weeks around your season, rest days, and long session day."
            : "Build your plan to get each week laid out day by day."}
        </FieldDescription>
        <Button className="self-start" nativeButton={false} render={<Link to="/plan" />}>
          <SparklesIcon data-icon="inline-start" />
          Build your plan
        </Button>
      </FieldSet>
    );
  }
  const goals = plan.goals as Goal[];
  const lead = anchorEvent(seasonEvents(goals.filter((goal) => goal.date >= today)));
  const weekStart = mondayOf(today);
  const weeksIn = plan.startWeek
    ? Math.max(1, Math.floor(daysBetween(plan.startWeek, weekStart) / 7) + 1)
    : null;
  const weeksTotal =
    lead && plan.startWeek
      ? Math.floor(daysBetween(plan.startWeek, mondayOf(lead.date)) / 7) + 1
      : null;
  const objective = lead
    ? GOAL_OBJECTIVES.find((item) => item.id === lead.goals[0]!.objective)?.label
    : null;
  return (
    <FieldSet>
      <FieldLegend>Your plan</FieldLegend>
      <div className="bg-muted/50 flex flex-col gap-1 rounded-lg border p-3">
        <span className="font-medium">
          {lead ? `${eventTitle(lead)} · ${objective}` : "Holding your fitness"}
        </span>
        <span className="text-muted-foreground text-sm">
          {weeksIn != null && weeksTotal != null
            ? `Week ${Math.min(weeksIn, weeksTotal)} of ${weeksTotal}`
            : weeksIn != null
              ? `Week ${weeksIn}`
              : null}
          {lead ? ` · ${formatDaysLeft(daysBetween(today, lead.date)).toLowerCase()}` : ""}
          {!lead ? "Add a goal on Season and VO2 will offer to adapt the plan." : ""}
        </span>
      </div>
      <FieldDescription>
        Rebuilding starts from your goals on Season and your last 12 weeks again.
      </FieldDescription>
      <Button
        variant="outline"
        className="self-start"
        nativeButton={false}
        render={<Link to="/plan" />}
      >
        <RefreshCwIcon data-icon="inline-start" />
        Rebuild plan
      </Button>
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
