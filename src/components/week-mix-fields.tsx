"use client";

import { Controller, useWatch, type Control } from "react-hook-form";

import {
  BUILD_PACES,
  KEY_SHARE_PRESETS,
  easySessionCount,
  keySessionCount,
  type BuildPace,
  type WeekMix,
} from "@/services/training-plan.ts";
import { keySessionTypes } from "@/services/week-target.ts";
import type { TrainingFormInput } from "@/lib/settings-form.ts";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Form = TrainingFormInput;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function WeekMixFields<T extends TrainingFormInput>({
  idPrefix,
  control: anyControl,
  recentSessionsPerWeek,
  onOpenSports,
}: {
  idPrefix: string;
  control: Control<T>;
  /** Average sessions a week over the last 8 weeks, when there is history. */
  recentSessionsPerWeek: number | null;
  onOpenSports?: () => void;
}) {
  const control = anyControl as unknown as Control<Form>;
  const mix = useWatch({ control, name: "weekMix" }) as WeekMix | undefined;
  const buildPace = useWatch({ control, name: "buildPace" }) as BuildPace | "";
  const sessions = Number.isFinite(mix?.sessions) ? (mix?.sessions ?? 0) : 0;
  const keyShare = mix?.keyShare ?? 0;
  const keys = keySessionCount({ sessions, keyShare });
  const easy = easySessionCount({ sessions, keyShare });
  const [main, ...rotating] = buildPace ? keySessionTypes(buildPace) : [];
  const paceLabel = BUILD_PACES.find((pace) => pace.id === buildPace)?.label;

  return (
    <FieldSet>
      <FieldLegend>Week mix</FieldLegend>
      <FieldDescription>
        How many sessions you do a week, and how many of them are key sessions. VO2 builds the key
        sessions each week from your build pace and fitness; the rest of the target is spread over
        easy sessions.
      </FieldDescription>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_1fr]">
        <Controller
          name="weekMix.sessions"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${idPrefix}-sessions`}>Sessions per week</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={`${idPrefix}-sessions`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={14}
                  step={1}
                  name={field.name}
                  value={Number.isFinite(field.value) ? field.value : ""}
                  aria-invalid={fieldState.invalid}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    field.onChange(Number.isFinite(value) ? value : Number.NaN);
                  }}
                  ref={field.ref}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>a week</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : recentSessionsPerWeek != null ? (
                <FieldDescription>
                  You did about {Math.round(recentSessionsPerWeek)} a week lately.
                </FieldDescription>
              ) : null}
            </Field>
          )}
        />
        <Controller
          name="weekMix.keyShare"
          control={control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-key-share`}>
                Key / easy · {field.value} / {100 - field.value}
              </FieldLabel>
              <ToggleGroup
                size="sm"
                variant="outline"
                spacing={0}
                aria-label="Key and easy split"
                value={[String(field.value)]}
                onValueChange={(next) => {
                  if (next[0] != null) field.onChange(Number(next[0]));
                }}
                className="flex-wrap"
              >
                {KEY_SHARE_PRESETS.map((preset) => (
                  <ToggleGroupItem key={preset.share} value={String(preset.share)}>
                    {preset.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Slider
                id={`${idPrefix}-key-share`}
                aria-label="Share of key sessions"
                min={0}
                max={100}
                step={5}
                value={[field.value]}
                onValueChange={(next) => {
                  const value = Array.isArray(next) ? next[0] : next;
                  if (typeof value === "number") field.onChange(value);
                }}
              />
            </Field>
          )}
        />
      </div>
      <p className="text-sm font-medium">
        {sessions > 0
          ? `${plural(sessions, "session")} → ${plural(keys, "key session")} · ${plural(easy, "easy session")}`
          : "Pick how many sessions you do a week."}
      </p>
      {keys > 0 && main && paceLabel ? (
        <FieldDescription>
          {paceLabel}: {main} every week
          {keys > 1 && rotating.length
            ? `, plus ${keys - 1} from ${rotating.join(" and ")}, rotating week to week`
            : ""}
          . Reps and length follow your fitness, and key sessions pause when form is very low.
        </FieldDescription>
      ) : keys === 0 && sessions > 0 ? (
        <FieldDescription>All easy: no intervals or time in zone this week.</FieldDescription>
      ) : null}
      {keyShare > 0 && sessions > 0 && keys === 0 ? (
        <FieldDescription>
          {keyShare}% of {plural(sessions, "session")} rounds to no key session. Add sessions or
          raise the split.
        </FieldDescription>
      ) : null}
      {onOpenSports ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onOpenSports}
        >
          Watts or heart rate per sport
        </Button>
      ) : null}
    </FieldSet>
  );
}
