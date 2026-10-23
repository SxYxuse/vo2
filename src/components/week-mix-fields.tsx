"use client";

import { Controller, useController, useWatch, type Control } from "react-hook-form";

import {
  KEY_SHARE_PRESETS,
  MAX_SESSIONS_PER_WEEK,
  easySessionRange,
  keySessionCount,
  type SessionHistory,
  type WeekMix,
} from "@/services/training-plan.ts";
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
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Form = TrainingFormInput;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "4–6 sessions", or "5 sessions" when the range is a single value. */
function rangeLabel(min: number, max: number, word: string) {
  if (min === max) return plural(min, word);
  return `${min}–${max} ${word}s`;
}

export function WeekMixFields<T extends TrainingFormInput>({
  idPrefix,
  control: anyControl,
  history,
  onOpenSports,
}: {
  idPrefix: string;
  control: Control<T>;
  /** Sessions a week over the last 3 months, when there is history. */
  history: SessionHistory | null;
  onOpenSports?: () => void;
}) {
  const control = anyControl as unknown as Control<Form>;
  const mix = useWatch({ control, name: "weekMix" }) as WeekMix | undefined;
  const minField = useController({ control, name: "weekMix.minSessions" });
  const maxField = useController({ control, name: "weekMix.maxSessions" });
  const minSessions = mix?.minSessions ?? 1;
  const maxSessions = mix?.maxSessions ?? minSessions;
  const keyShare = mix?.keyShare ?? 0;
  const doubleDays = mix?.doubleDays ?? 0;
  const keys = keySessionCount({ minSessions, maxSessions, keyShare, doubleDays });
  const easy = easySessionRange({ minSessions, maxSessions, keyShare, doubleDays });
  // With one rest day there are six training days; more sessions than that need double days.
  const doublesNeeded = Math.max(0, maxSessions - 6);
  const rangeError = minField.fieldState.error ?? maxField.fieldState.error;
  const matchesHistory =
    history != null && history.low === minSessions && history.high === maxSessions;

  return (
    <FieldSet>
      <FieldLegend>Week mix</FieldLegend>
      <FieldDescription>
        How many sessions you do a week, and how many of them are key sessions. VO2 builds the key
        sessions each week from your season phase and fitness; the rest of the target is spread over
        easy sessions.
      </FieldDescription>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_1fr]">
        <Field data-invalid={Boolean(rangeError)}>
          <FieldLabel htmlFor={`${idPrefix}-sessions`}>
            Sessions per week ·{" "}
            {minSessions === maxSessions ? minSessions : `${minSessions}–${maxSessions}`}
          </FieldLabel>
          <Slider
            id={`${idPrefix}-sessions`}
            aria-label="Sessions per week, fewest and most"
            min={1}
            max={MAX_SESSIONS_PER_WEEK}
            step={1}
            minStepsBetweenValues={0}
            value={[minSessions, maxSessions]}
            onValueChange={(next) => {
              if (!Array.isArray(next)) return;
              const [low, high] = next;
              if (low !== minSessions) minField.field.onChange(low);
              if (high !== maxSessions) maxField.field.onChange(high);
            }}
          />
          {rangeError ? (
            <FieldError errors={[rangeError]} />
          ) : history ? (
            <FieldDescription>
              Last 3 months: about {Math.round(history.average)} a week, usually{" "}
              {history.low === history.high ? history.low : `${history.low}–${history.high}`}.{" "}
              {matchesHistory ? null : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    minField.field.onChange(history.low);
                    maxField.field.onChange(history.high);
                  }}
                >
                  Use{" "}
                  {history.low === history.high ? history.low : `${history.low}–${history.high}`}
                </Button>
              )}
            </FieldDescription>
          ) : (
            <FieldDescription>A range lets busy and quiet weeks both count.</FieldDescription>
          )}
        </Field>
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
        {`${rangeLabel(minSessions, maxSessions, "session")} → ${plural(keys, "key session")} · ${rangeLabel(easy.min, easy.max, "easy session")}`}
      </p>
      {keys > 0 ? (
        <FieldDescription>
          Your season phase picks the key session types, and the weeks before a race may hold fewer.
          Reps and length follow your fitness, and key sessions pause when form is very low.
        </FieldDescription>
      ) : keys === 0 && keyShare === 0 ? (
        <FieldDescription>All easy: no intervals or time in zone this week.</FieldDescription>
      ) : null}
      {keyShare > 0 && keys === 0 ? (
        <FieldDescription>
          {keyShare}% of {plural(minSessions, "session")} rounds to no key session. Raise the fewest
          sessions or the split.
        </FieldDescription>
      ) : (
        <FieldDescription>
          Key sessions come from the low end of the range, so they happen even in a quiet week. The
          number of easy sessions settles within the range as the week goes.
        </FieldDescription>
      )}
      <Controller
        name="weekMix.doubleDays"
        control={control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-double-days`}>Double days per week</FieldLabel>
            <ToggleGroup
              id={`${idPrefix}-double-days`}
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="Double days per week"
              value={[String(field.value ?? 0)]}
              onValueChange={(next) => {
                if (next[0] != null) field.onChange(Number(next[0]));
              }}
              className="flex-wrap"
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((count) => (
                <ToggleGroupItem key={count} value={String(count)}>
                  {count === 0 ? "None" : count}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              Days you are fine doing two sessions, any sports: a ride then a run, a swim then
              strength. VO2 suggests a second sport when the week needs it; you pick which.
              {doublesNeeded > (field.value ?? 0)
                ? ` Up to ${maxSessions} sessions needs about ${doublesNeeded} double ${doublesNeeded === 1 ? "day" : "days"}.`
                : ""}
            </FieldDescription>
          </Field>
        )}
      />
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
