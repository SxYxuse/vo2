"use client";

import { format } from "date-fns";
import { CalendarIcon, RulerIcon, WeightIcon } from "lucide-react";
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
  suggestedTargetHours,
  trainingConsistency,
  type HoursIntent,
} from "@/services/training-plan.ts";
import type { ProfileFormValues, TrainingFormInput } from "@/lib/settings-form.ts";
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
  const birthDate = useWatch({ control, name: "birthDate" as FieldPath<T> }) as string | null;
  const age = ageFromBirthDate(birthDate);
  const birth = birthDate ? parseBirthDate(birthDate) : null;

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
        <Input id={`${idPrefix}-name`} value={userName} disabled />
        <FieldDescription>From your Strava account.</FieldDescription>
      </Field>
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
                    onSelect={(next) => field.onChange(next ? formatBirthDate(next) : null)}
                  />
                </PopoverContent>
              </Popover>
              {age != null ? (
                <Badge variant="secondary">{age} years old</Badge>
              ) : (
                <Badge variant="outline">Age unknown</Badge>
              )}
              {birthDate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => field.onChange(null)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            <FieldDescription>
              Used later for age-graded analysis. Age updates from this date.
            </FieldDescription>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )}
      />
      <Controller
        name={"weightKg" as FieldPath<T>}
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
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
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )}
      />
      <Controller
        name={"heightCm" as FieldPath<T>}
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
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
                name={field.name}
                value={field.value as string}
                aria-invalid={fieldState.invalid}
                onBlur={field.onBlur}
                onChange={field.onChange}
                ref={field.ref}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>
                  <RulerIcon />
                  cm
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
          </Field>
        )}
      />
    </FieldGroup>
  );
}

export function TrainingPaceFields<T extends TrainingFormInput>({
  idPrefix,
  control,
}: {
  idPrefix: string;
  control: Control<T>;
}) {
  return (
    <Controller
      name={"buildPace" as FieldPath<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldSet data-invalid={fieldState.invalid}>
          <FieldLegend>Fitness and form</FieldLegend>
          <FieldDescription>
            Keep building, or hold where you are. Faster ramps raise fitness quicker and sit you in
            more fatigue.
          </FieldDescription>
          <RadioGroup
            name={field.name}
            value={(field.value as string) || undefined}
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

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Weekly sessions</FieldLegend>
        <FieldDescription>
          Caps for suggested run and ride sessions in the weekly bucket. Other sports still count
          toward load.
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
          Your last 3 months average {avgHours > 0.2 ? formatHours(avgHours) : "is still thin"}.
          Choose whether to cut back, keep that volume, or add hours.
        </FieldDescription>
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
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Field tests</FieldLegend>
        <FieldDescription>
          Published field tests for FTP, VO2max, and lactate-threshold HR. They live on Tests, not
          in the weekly bucket. Turn off any you do not want suggested.
        </FieldDescription>
        <Controller
          name={"suggestFtpTest" as FieldPath<T>}
          control={control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch
                id={`${idPrefix}-ftp-test`}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
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
          )}
        />
        <Controller
          name={"suggestBeepTest" as FieldPath<T>}
          control={control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch
                id={`${idPrefix}-beep-test`}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
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
          )}
        />
        <Controller
          name={"suggestRunLthrTest" as FieldPath<T>}
          control={control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch
                id={`${idPrefix}-run-lthr`}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
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
          )}
        />
      </FieldSet>
    </FieldGroup>
  );
}
