"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  format,
  parseISO,
  subDays,
} from "date-fns";

import { runDistanceLabel } from "@/components/best-labels.ts";
import { useOnline } from "@/hooks/use-online.ts";
import {
  coachPlanQueryOptions,
  seasonQueryOptions,
  trainingPacesQueryOptions,
} from "@/lib/queries.ts";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { formatPaceClock } from "@/services/locomotion.ts";
import { ZONE_2_MIN_SEC } from "@/services/easy-pace.ts";
import { savePaceChoice, saveRaceResult } from "@/services/training-paces.ts";
import {
  DEFAULT_TARGET_M,
  ESTIMATE_WINDOW_DAYS,
  PACE_TYPES,
  RACE_DISTANCES,
  parseRaceTime,
  predictRaceSeconds,
  raceResultSchema,
  type EasyFrom,
  type PaceChoice,
  type PaceEstimate,
  type PacesFrom,
  type RaceResult,
  type RunEffort,
  type TrainingPaces,
} from "@/services/training-paces.types.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";

const formatDay = (key: string) => format(parseISO(key), "d MMM yyyy");

function raceLine(race: RaceResult) {
  return `${runDistanceLabel(race.metres)} in ${formatDuration(race.seconds)} on ${formatDay(race.date)}`;
}

function weeksAgo(start: string) {
  const weeks = differenceInCalendarWeeks(new Date(), new Date(start), { weekStartsOn: 1 });
  return weeks < 1 ? "this week" : weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}

function effortLine(effort: RunEffort) {
  return `${runDistanceLabel(effort.metres)} in ${formatDuration(Math.round(effort.seconds))} on ${effort.name}, ${format(new Date(effort.start), "d MMM yyyy")}`;
}

function estimateLine(estimate: PaceEstimate) {
  const effort = `${runDistanceLabel(estimate.from.metres)} in ${formatDuration(Math.round(estimate.from.seconds))} on ${estimate.from.name}, ${format(new Date(estimate.from.start), "d MMM")}`;
  return estimate.capped
    ? `your best ${effort}, held to within 5 % of your next-best run`
    : `your best ${effort}`;
}

const targetLabel = (metres: number) =>
  metres === DEFAULT_TARGET_M ? "10 km" : `your A goal's ${Math.round(metres / 100) / 10} km`;

/** Where the paces come from, in a sentence. */
function sourceText(paces: Extract<TrainingPaces, { vdot: number }>) {
  if (paces.source === "race") {
    return `From your race result: ${raceLine(paces.raceResult!)}. VDOT ${paces.vdot}.`;
  }
  if (paces.source === "effort") {
    return `From your best effort: ${effortLine(paces.effort!)}. VDOT ${paces.vdot}.`;
  }
  const estimate = paces.estimate!;
  const stale =
    paces.from === "race" ? " Your race result is too old to set them, so they are estimated." : "";
  return `Estimated from road runs of the last ${WINDOW_WEEKS} weeks, aiming at ${targetLabel(estimate.targetMetres)} and older runs counting a little less: ${estimateLine(estimate)}. VDOT ${paces.vdot}.${stale}`;
}

type Paces = TrainingPaces;

/** Saves a Paces change and refreshes what reads the paces. */
function useSavePaces<T>(save: (value: T) => Promise<Paces>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: async (saved) => {
      queryClient.setQueryData(trainingPacesQueryOptions.queryKey, saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: seasonQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: coachPlanQueryOptions.queryKey }),
      ]);
    },
  });
}

/** The athlete's training paces, predicted race times, and what they are read from. */
export function TrainingPacesSection({ idPrefix }: { idPrefix: string }) {
  const { data: paces } = useQuery(trainingPacesQueryOptions);
  if (!paces) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Training paces</FieldLegend>
        {paces.source === "none" ? (
          <FieldDescription>
            No paces yet. VO2 reads them from best efforts of a mile or more in road runs of the
            last {WINDOW_WEEKS} weeks, and needs at least two such runs. Or pick a best effort or
            set a recent race result below.
          </FieldDescription>
        ) : (
          <>
            <FieldDescription>{sourceText(paces)}</FieldDescription>
            <ul className="flex flex-col divide-y" aria-label="Training paces">
              {PACE_TYPES.map((type) => {
                const range = paces.paces[type.id];
                const fromHeart = type.id === "easy" && paces.easySource === "heartRate";
                return (
                  <li key={type.id} className="flex items-start gap-3 py-2.5">
                    <span
                      aria-hidden
                      className="bg-ds-amber-200 text-ds-amber-900 flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
                    >
                      {type.letter}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{type.label}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatPaceClock(range.fastSecPerKm)}–
                          {formatPaceClock(range.slowSecPerKm)} /km
                        </span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {fromHeart ? "From your zone 2 heart rate. " : ""}
                        {type.hint}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </FieldSet>
      {paces.source === "none" ? null : (
        <>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend>Predicted race times</FieldLegend>
            <FieldDescription>What these paces say you could run today.</FieldDescription>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {RACE_DISTANCES.filter((metres) => metres >= 5000).map((metres) => (
                <div key={metres} className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">{runDistanceLabel(metres)}</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {formatDuration(predictRaceSeconds(paces.vdot, metres))}
                  </dd>
                </div>
              ))}
            </dl>
          </FieldSet>
        </>
      )}
      {paces.signedIn ? (
        <>
          <FieldSeparator />
          <PacesFromField key={paces.from} idPrefix={idPrefix} paces={paces} />
          <FieldSeparator />
          <EasyFromField idPrefix={idPrefix} paces={paces} />
        </>
      ) : null}
    </FieldGroup>
  );
}

const PACES_FROM_OPTIONS: { id: PacesFrom; label: string; hint: string }[] = [
  {
    id: "automatic",
    label: "Automatic",
    hint: "VO2 estimates them from your recent road runs, and keeps them up to date.",
  },
  {
    id: "effort",
    label: "One of your best efforts",
    hint: "Pick one. It is used as it is until you change it.",
  },
  {
    id: "race",
    label: "A race result",
    hint: "Enter a race or time trial from the last 16 weeks.",
  },
];

function ChoiceCards<T extends string>({
  name,
  idPrefix,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  idPrefix: string;
  value: T;
  options: { id: T; label: string; hint: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup
      name={name}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((item) => item.id === next);
        if (option) onChange(option.id);
      }}
      className="gap-2"
    >
      {options.map((option) => {
        const id = `${idPrefix}-${name}-${option.id}`;
        return (
          <FieldLabel key={option.id} htmlFor={id} className="w-full">
            <Field orientation="horizontal" className="items-start p-3">
              <RadioGroupItem value={option.id} id={id} />
              <FieldContent>
                <FieldTitle>{option.label}</FieldTitle>
                <FieldDescription>{option.hint}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}

function SaveError({ show }: { show: boolean }) {
  return show ? (
    <Alert variant="destructive">
      <AlertDescription>Could not save. Try again.</AlertDescription>
    </Alert>
  ) : null;
}

/**
 * What the paces are read from. Automatic saves at once; a best effort or a race result only
 * once one is picked or entered, so choosing the option alone changes no pace.
 */
function PacesFromField({ idPrefix, paces }: { idPrefix: string; paces: Paces }) {
  const online = useOnline();
  const [choice, setChoice] = useState<PacesFrom>(paces.from);
  const save = useSavePaces((next: PaceChoice) => savePaceChoice({ data: { choice: next } }));
  return (
    <FieldSet>
      <FieldLegend>Paces from</FieldLegend>
      {online ? null : (
        <FieldDescription>
          You are offline. Changes wait until you are back online.
        </FieldDescription>
      )}
      <ChoiceCards
        name="paces-from"
        idPrefix={idPrefix}
        value={choice}
        options={PACES_FROM_OPTIONS}
        disabled={!online || save.isPending}
        onChange={(next) => {
          setChoice(next);
          if (next === "automatic" && paces.from !== "automatic") {
            save.mutate({ from: "automatic" });
          }
        }}
      />
      {choice === "effort" ? (
        <EffortPicker
          idPrefix={idPrefix}
          paces={paces}
          disabled={!online || save.isPending}
          onPick={(effort) =>
            save.mutate({ from: "effort", activityId: effort.activityId, metres: effort.metres })
          }
        />
      ) : null}
      {choice === "race" ? (
        <RaceResultField
          idPrefix={idPrefix}
          raceResult={paces.raceResult}
          current={paces.source === "race"}
        />
      ) : null}
      <SaveError show={save.isError} />
    </FieldSet>
  );
}

const effortKey = (effort: RunEffort) => `${effort.activityId}:${effort.metres}`;

/** The recent and all-time best at each race distance, and the one picked. */
function EffortPicker({
  idPrefix,
  paces,
  disabled,
  onPick,
}: {
  idPrefix: string;
  paces: Paces;
  disabled: boolean;
  onPick: (effort: RunEffort) => void;
}) {
  const picked = paces.from === "effort" ? paces.effort : null;
  const options = paces.choices.flatMap((choice) => {
    const sameRun = choice.recent?.activityId === choice.allTime?.activityId;
    return [
      ...(choice.recent
        ? [{ effort: choice.recent, kind: sameRun ? "Recent and all-time best" : "Recent best" }]
        : []),
      ...(choice.allTime && !sameRun ? [{ effort: choice.allTime, kind: "All-time best" }] : []),
    ];
  });
  if (picked && !options.some((option) => effortKey(option.effort) === effortKey(picked))) {
    options.unshift({ effort: picked, kind: "Picked" });
  }
  if (!options.length) {
    return (
      <FieldDescription>
        No best efforts yet. They come from road runs of a mile or more with a route.
      </FieldDescription>
    );
  }
  const stale =
    picked && differenceInCalendarDays(new Date(), new Date(picked.start)) > WINDOW_DAYS;
  return (
    <div className="flex flex-col gap-3">
      {stale ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Your picked effort is older than {WINDOW_WEEKS} weeks, so it may not say much about
              your fitness now. It keeps setting your paces until you pick another.
            </span>
            {paces.suggestion ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-10 self-start sm:min-h-8"
                disabled={disabled}
                onClick={() => onPick(paces.suggestion!)}
              >
                Use your recent {runDistanceLabel(paces.suggestion.metres)} best,{" "}
                {formatDuration(Math.round(paces.suggestion.seconds))}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <RadioGroup
        name="best-effort"
        aria-label="Best efforts"
        value={picked ? effortKey(picked) : ""}
        disabled={disabled}
        onValueChange={(key) => {
          const option = options.find((item) => effortKey(item.effort) === key);
          if (option) onPick(option.effort);
        }}
        className="gap-2"
      >
        {options.map(({ effort, kind }) => {
          const id = `${idPrefix}-effort-${effortKey(effort)}`;
          return (
            <FieldLabel key={id} htmlFor={id} className="w-full">
              <Field orientation="horizontal" className="items-start p-3">
                <RadioGroupItem value={effortKey(effort)} id={id} />
                <FieldContent>
                  <FieldTitle className="flex w-full flex-wrap items-baseline justify-between gap-x-2">
                    <span>{runDistanceLabel(effort.metres)}</span>
                    <span className="tabular-nums">
                      {formatDuration(Math.round(effort.seconds))}
                    </span>
                  </FieldTitle>
                  <FieldDescription>
                    {kind} · {effort.name}, {format(new Date(effort.start), "d MMM yyyy")} ·{" "}
                    {weeksAgo(effort.start)}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>
    </div>
  );
}

const EASY_FROM_OPTIONS: { id: EasyFrom; label: string; hint: string }[] = [
  {
    id: "heartRate",
    label: "Heart rate (zone 2)",
    hint: "The pace you hold in running zone 2 on flat road runs of the last 8 weeks.",
  },
  {
    id: "vdot",
    label: "Fitness estimate (VDOT)",
    hint: "The easy band of the same VDOT as your other paces.",
  },
];

/** Why the easy pace isn't from heart rate although the athlete chose it. */
function easyFallbackNote(paces: Paces) {
  if (paces.easyFrom !== "heartRate" || paces.source === "none") return null;
  if (paces.easySource === "heartRate") return null;
  if (paces.heart.kind === "zones-missing") {
    return "VO2 has no running heart-rate zones for you yet, so your easy pace comes from your VDOT. Set them under Heart rate.";
  }
  return `Not enough zone 2 running yet: ${paces.heart.minutes} of ${ZONE_2_MIN_SEC / 60} minutes on flat road runs of the last 8 weeks. Until then your easy pace comes from your VDOT.`;
}

/** Where the easy pace comes from; the other paces always come from the VDOT. */
function EasyFromField({ idPrefix, paces }: { idPrefix: string; paces: Paces }) {
  const online = useOnline();
  const save = useSavePaces((easyFrom: EasyFrom) =>
    savePaceChoice({ data: { choice: { easyFrom } } }),
  );
  const note = easyFallbackNote(paces);
  const { heart } = paces;
  return (
    <FieldSet>
      <FieldLegend>Easy pace from</FieldLegend>
      <ChoiceCards
        name="easy-from"
        idPrefix={idPrefix}
        value={save.isPending && save.variables ? save.variables : paces.easyFrom}
        options={EASY_FROM_OPTIONS}
        disabled={!online || save.isPending}
        onChange={(next) => save.mutate(next)}
      />
      {note ? (
        <Alert>
          <AlertDescription>{note}</AlertDescription>
        </Alert>
      ) : heart.kind === "zone2" && heart.range ? (
        <FieldDescription>
          Your running zone 2 is {heart.minBpm}–{heart.maxBpm} bpm. VO2 found {heart.minutes}{" "}
          minutes of it on flat road runs of the last 8 weeks, held at{" "}
          {formatPaceClock(heart.range.fastSecPerKm)}–{formatPaceClock(heart.range.slowSecPerKm)}{" "}
          /km.
        </FieldDescription>
      ) : null}
      <SaveError show={save.isError} />
    </FieldSet>
  );
}

const todayKey = () => format(new Date(), "yyyy-MM-dd");
const oldestRaceKey = () => format(subDays(new Date(), ESTIMATE_WINDOW_DAYS), "yyyy-MM-dd");
const WINDOW_DAYS = ESTIMATE_WINDOW_DAYS;
const WINDOW_WEEKS = ESTIMATE_WINDOW_DAYS / 7;

/**
 * Sets or clears the race result the paces are read from. Saved on its own with a button, not
 * with the settings form's autosave: a half-typed time would change every pace.
 */
function RaceResultField({
  idPrefix,
  raceResult,
  current,
}: {
  idPrefix: string;
  raceResult: RaceResult | null;
  /** Whether the result still sets the paces, or is older than the estimate window. */
  current: boolean;
}) {
  const online = useOnline();
  const [metres, setMetres] = useState<number>(RACE_DISTANCES[2]);
  const [time, setTime] = useState("");
  const [date, setDate] = useState(todayKey);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useSavePaces((next: RaceResult | null) =>
    saveRaceResult({ data: { raceResult: next } }),
  );

  function submit() {
    const seconds = parseRaceTime(time);
    if (seconds == null) {
      setInvalid("Enter a time as mm:ss or h:mm:ss.");
      return;
    }
    const parsed = raceResultSchema.safeParse({ metres, seconds, date });
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? "Check the result.");
      return;
    }
    if (date > todayKey()) {
      setInvalid("Pick a race that has already happened.");
      return;
    }
    if (date < oldestRaceKey()) {
      setInvalid(`Pick a race from the last ${WINDOW_WEEKS} weeks.`);
      return;
    }
    setInvalid(null);
    save.mutate(parsed.data, { onSuccess: () => setTime("") });
  }

  const id = (name: string) => `${idPrefix}-race-${name}`;

  return (
    <div className="flex flex-col gap-3">
      <FieldDescription>
        A race or all-out time trial on a flat road from the last {WINDOW_WEEKS} weeks. It sets your
        paces until you clear it, or until it is {WINDOW_WEEKS} weeks old.
      </FieldDescription>
      {raceResult ? (
        <Field orientation="horizontal" className="flex-wrap items-center gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm tabular-nums">{raceLine(raceResult)}</span>
            {current ? null : (
              <span className="text-muted-foreground text-xs">
                Older than {WINDOW_WEEKS} weeks, so it no longer sets your paces. Clear it and set a
                newer one.
              </span>
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            className="ms-auto min-h-10 sm:min-h-8"
            disabled={save.isPending || !online}
            onClick={() => save.mutate(null)}
          >
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            Clear race result
          </Button>
        </Field>
      ) : (
        // Settings is a form already: Enter in these fields saves the result, not the page.
        <div
          className="flex flex-col gap-3"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field className="col-span-2 sm:col-span-1">
              <FieldLabel htmlFor={id("distance")}>Distance</FieldLabel>
              <NativeSelect
                id={id("distance")}
                value={String(metres)}
                onChange={(event) => setMetres(Number(event.target.value))}
                className="min-h-10 w-full sm:min-h-8"
              >
                {RACE_DISTANCES.map((metres) => (
                  <NativeSelectOption key={metres} value={String(metres)}>
                    {runDistanceLabel(metres)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field data-invalid={invalid != null}>
              <FieldLabel htmlFor={id("time")}>Time</FieldLabel>
              <Input
                id={id("time")}
                inputMode="numeric"
                autoComplete="off"
                placeholder="45:00"
                value={time}
                aria-invalid={invalid != null}
                onChange={(event) => setTime(event.target.value)}
                className="min-h-10 sm:min-h-8"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={id("date")}>Date</FieldLabel>
              <Input
                id={id("date")}
                type="date"
                min={oldestRaceKey()}
                max={todayKey()}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="min-h-10 sm:min-h-8"
              />
            </Field>
          </div>
          {invalid ? <FieldError>{invalid}</FieldError> : null}
          <Button
            type="button"
            className="min-h-10 sm:min-h-8 sm:self-end"
            disabled={!time.trim() || save.isPending || !online}
            onClick={submit}
          >
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            Set race result
          </Button>
        </div>
      )}
      {save.error ? (
        <Alert variant="destructive">
          <AlertDescription>Could not save the race result. Try again.</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
