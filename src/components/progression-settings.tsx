"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { MinusIcon, PlusIcon, TrendingUpIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { saveCoachPlanProgression } from "@/services/coach-plan.ts";
import { firstWeekOffBudget, PEAK_LIMIT, PEAK_STEP } from "@/services/coach-plan-budget.ts";
import {
  amountText,
  PROGRESSION_MARKS,
  progressionLabel,
  type CoachPlanState,
  type PlanSport,
  type Progression,
  type SeasonVolume,
  type SportVolume,
} from "@/services/coach-plan.types.ts";
import { addDayKey } from "@/services/day-key.ts";
import { mondayOf } from "@/services/season-phase.ts";
import { seasonEvents } from "@/services/season.types.ts";
import {
  ceilingFor,
  projectedAmounts,
  projectedBudgets,
  SPORT_VOLUME_LABEL,
  VolumeChart,
  weekReaching,
  type SportChoice,
} from "@/components/season-volume.tsx";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/*
 * Settings → Training → Progression (ADR 0058): per planned sport, how fast its weekly volume
 * grows (a slider from Hold to Steep) and its peak week (the one VO2 recommends, or the athlete's
 * own), with the season redrawn live. It saves with its own button, since a save can rewrite the
 * weeks ahead on the athlete's key.
 */

type Choices = Partial<Record<PlanSport, SportChoice>>;

const choicesOf = (volume: SeasonVolume): Choices =>
  Object.fromEntries(
    volume.sports.map((sport) => [sport.sport, { growth: sport.growth, peak: sport.peak }]),
  );

/** What's saved: a sport left at its default with the recommended peak stays unset. */
function progressionOf(volume: SeasonVolume, choices: Choices): Progression {
  return Object.fromEntries(
    volume.sports.flatMap((sport) => {
      const choice = choices[sport.sport];
      if (!choice || (choice.growth == null && choice.peak == null)) return [];
      return [[sport.sport, { growth: choice.growth ?? sport.defaultGrowth, peak: choice.peak }]];
    }),
  );
}

function SportProgression({
  sport,
  volume,
  choice,
  onChange,
  written,
  events,
}: {
  sport: SportVolume;
  volume: SeasonVolume;
  choice: SportChoice;
  onChange: (next: SportChoice) => void;
  written: Set<string>;
  events: ReturnType<typeof seasonEvents>;
}) {
  const growth = choice.growth ?? sport.defaultGrowth;
  const amounts = projectedAmounts(volume.shape, sport, choice);
  const ceiling = ceilingFor(sport, choice);
  const reached = weekReaching(volume.shape, amounts, ceiling);
  const above = choice.peak != null && choice.peak > sport.recommended;
  const step = PEAK_STEP[sport.sport];
  const ownPeak = choice.peak ?? Math.ceil(sport.recommended / step) * step;
  const label = SPORT_VOLUME_LABEL[sport.sport];
  const lines = [
    {
      value: sport.recommended,
      label: `recommended ${amountText(sport.sport, sport.recommended)}`,
      tone: "muted" as const,
    },
    ...(choice.peak != null
      ? [
          {
            value: choice.peak,
            label: `your peak ${amountText(sport.sport, choice.peak)}`,
            tone: "warning" as const,
          },
        ]
      : []),
  ];
  return (
    // Named here: the legend shares a row with the progression's label, outside the fieldset's
    // first child.
    <FieldSet aria-label={label.name}>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLegend variant="label">{label.name}</FieldLegend>
        <span className="text-muted-foreground text-xs tabular-nums">
          {progressionLabel(growth)}
          {growth ? ` · +${growth} % a week` : " · no growth"}
        </span>
      </div>
      <Slider
        aria-label={`${label.name} progression`}
        min={0}
        max={10}
        step={0.5}
        value={[growth]}
        onValueChange={(next) => {
          const value = Array.isArray(next) ? next[0] : next;
          if (typeof value === "number") onChange({ ...choice, growth: value });
        }}
        className="py-3"
      />
      <div className="text-muted-foreground relative -mt-2 h-4 text-[11px]" aria-hidden>
        {PROGRESSION_MARKS.map((mark) => (
          <button
            key={mark.label}
            type="button"
            tabIndex={-1}
            className="absolute top-0 -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: `${mark.growth * 10}%` }}
            onClick={() => onChange({ ...choice, growth: mark.growth })}
          >
            {mark.label}
          </button>
        ))}
      </div>
      <VolumeChart
        sport={sport.sport}
        shape={volume.shape}
        amounts={amounts}
        written={written}
        events={events}
        lines={lines}
      />
      <p className="text-muted-foreground text-xs">
        {growth === 0
          ? `Holds at ${amountText(sport.sport, sport.seed.level)}; lighter weeks and the taper still ease off.`
          : reached
            ? `Reaches ${amountText(sport.sport, ceiling)} the week of ${format(parseISO(reached), "d MMM")}, then holds.`
            : `Peaks at ${amountText(sport.sport, Math.max(...amounts))}: the season is too short to reach ${amountText(sport.sport, ceiling)} at this progression.`}
      </p>
      <div className="ring-foreground/10 flex flex-col gap-2 rounded-lg p-3 ring-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">Peak week</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            recommended {amountText(sport.sport, sport.recommended)}
          </span>
        </div>
        <ToggleGroup
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-2"
          value={[choice.peak == null ? "recommended" : "own"]}
          onValueChange={(next) => {
            const picked = (next as string[])[0];
            if (picked === "recommended") onChange({ ...choice, peak: null });
            if (picked === "own") onChange({ ...choice, peak: ownPeak });
          }}
        >
          <ToggleGroupItem value="recommended" className="w-full">
            Recommended
          </ToggleGroupItem>
          <ToggleGroupItem value="own" className="w-full">
            My own
          </ToggleGroupItem>
        </ToggleGroup>
        {choice.peak != null ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={`Lower ${label.name.toLowerCase()} peak`}
              disabled={choice.peak <= step}
              onClick={() => onChange({ ...choice, peak: Math.max(step, choice.peak! - step) })}
            >
              <MinusIcon />
            </Button>
            <output className="flex-1 text-center text-xl font-semibold tabular-nums">
              {amountText(sport.sport, choice.peak)}
            </output>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={`Raise ${label.name.toLowerCase()} peak`}
              disabled={choice.peak >= PEAK_LIMIT[sport.sport]}
              onClick={() =>
                onChange({
                  ...choice,
                  peak: Math.min(PEAK_LIMIT[sport.sport], choice.peak! + step),
                })
              }
            >
              <PlusIcon />
            </Button>
          </div>
        ) : null}
        {above ? (
          <p className="text-warning text-xs">
            {Math.round((choice.peak! / sport.recommended - 1) * 100)} % above the recommended peak
            for your usual {amountText(sport.sport, sport.seed.usual)}. The plan's week-to-week
            rules still apply.
          </p>
        ) : null}
        {sport.goal && ceiling < sport.goal.floor ? (
          <p className="text-warning text-xs">
            Peak {amountText(sport.sport, ceiling)}, under the{" "}
            {amountText(sport.sport, sport.goal.floor)} {sport.goal.name} usually asks for.
          </p>
        ) : null}
      </div>
    </FieldSet>
  );
}

/** What the athlete saved, as a key: the draft starts again from it when it changes. */
export const savedProgressionKey = (volume: SeasonVolume) => JSON.stringify(choicesOf(volume));

export function ProgressionSettings({ state }: { state: CoachPlanState }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const volume = state.volume;
  const [choices, setChoices] = useState<Choices>(() => (volume ? choicesOf(volume) : {}));
  const savedKey = volume ? savedProgressionKey(volume) : "";
  const save = useMutation({
    mutationFn: (progression: Progression) => saveCoachPlanProgression({ data: { progression } }),
    onSuccess: (next) => queryClient.setQueryData(coachPlanQueryOptions.queryKey, next),
  });
  const rewriteFrom = useMemo(() => {
    if (!volume || !state.plan) return null;
    const nextWeek = addDayKey(mondayOf(state.today), 7);
    return firstWeekOffBudget(state.plan.weeks, projectedBudgets(volume, choices), nextWeek)
      ? nextWeek
      : null;
  }, [volume, state.plan, state.today, choices]);
  // Hidden without an A goal: there are no phases to grow through (ADR 0058).
  if (!volume) return null;
  const changed = JSON.stringify(choices) !== savedKey;
  const written = new Set((state.plan?.weeks ?? []).map((week) => week.weekStart));
  const events = seasonEvents(state.goals);
  return (
    <FieldGroup>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Progression</h3>
        <FieldDescription>
          How fast each sport's weekly volume grows toward your A goal, up to its peak week. The
          plan's week-to-week rules always apply.
        </FieldDescription>
      </div>
      {volume.sports.map((sport) => (
        <SportProgression
          key={sport.sport}
          sport={sport}
          volume={volume}
          choice={choices[sport.sport] ?? { growth: null, peak: null }}
          onChange={(next) => setChoices((current) => ({ ...current, [sport.sport]: next }))}
          written={written}
          events={events}
        />
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          disabled={!online || !changed || save.isPending}
          onClick={() => save.mutate(progressionOf(volume, choices))}
        >
          {save.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <TrendingUpIcon data-icon="inline-start" />
          )}
          Save progression
        </Button>
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {!online
            ? "Offline: progression can't be saved."
            : save.error
              ? "Could not save. Nothing was saved."
              : !changed
                ? null
                : rewriteFrom
                  ? `Saving writes the weeks from ${format(parseISO(rewriteFrom), "d MMM")} again, on your own key.`
                  : "Your written weeks stay as they are; later weeks are written with the new volume."}
        </p>
      </div>
    </FieldGroup>
  );
}
