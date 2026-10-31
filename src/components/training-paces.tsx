"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

import { runDistanceLabel } from "@/components/best-labels.ts";
import { useOnline } from "@/hooks/use-online.ts";
import { seasonQueryOptions, trainingPacesQueryOptions } from "@/lib/queries.ts";
import { formatDuration } from "@/services/activity-detail.types.ts";
import { formatPaceClock } from "@/services/locomotion.ts";
import { saveRaceResult } from "@/services/training-paces.ts";
import {
  ESTIMATE_WINDOW_DAYS,
  PACE_TYPES,
  RACE_DISTANCES,
  parseRaceTime,
  predictRaceSeconds,
  raceResultSchema,
  type PaceEstimate,
  type RaceResult,
  type TrainingPaces,
} from "@/services/training-paces.types.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

const formatDay = (key: string) => format(parseISO(key), "d MMM yyyy");

function raceLine(race: RaceResult) {
  return `${runDistanceLabel(race.metres)} in ${formatDuration(race.seconds)} on ${formatDay(race.date)}`;
}

function estimateLine(estimate: PaceEstimate) {
  const { from } = estimate;
  const effort = `${runDistanceLabel(from.metres)} in ${formatDuration(from.seconds)} on ${from.name}, ${format(new Date(from.start), "d MMM")}`;
  return estimate.capped
    ? `your best effort, ${effort}, held to within 5 % of your next-best run`
    : `your best effort, ${effort}`;
}

/** Where the paces come from, in a sentence. */
function sourceText(paces: Extract<TrainingPaces, { vdot: number }>) {
  if (paces.source === "race") {
    const estimate = paces.estimate
      ? ` Your recent best efforts alone give VDOT ${paces.estimate.vdot}.`
      : "";
    return `From your race result: ${raceLine(paces.raceResult!)}. VDOT ${paces.vdot}.${estimate}`;
  }
  return `Estimated from road runs of the last ${ESTIMATE_WINDOW_DAYS / 7} weeks: ${estimateLine(paces.estimate!)}. VDOT ${paces.vdot}. A best effort inside a training run is slower than a race, so a race result below is more precise.`;
}

/** The athlete's training paces, predicted race times, and the race result that sets them. */
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
            last {ESTIMATE_WINDOW_DAYS / 7} weeks, and needs at least two such runs. Or set a recent
            race result below.
          </FieldDescription>
        ) : (
          <>
            <FieldDescription>{sourceText(paces)}</FieldDescription>
            <ul className="flex flex-col divide-y" aria-label="Training paces">
              {PACE_TYPES.map((type) => {
                const range = paces.paces[type.id];
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
                      <span className="text-muted-foreground text-xs">{type.hint}</span>
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
          <RaceResultField idPrefix={idPrefix} raceResult={paces.raceResult} />
        </>
      ) : null}
    </FieldGroup>
  );
}

const todayKey = () => format(new Date(), "yyyy-MM-dd");

/**
 * Sets or clears the race result the paces are read from. Saved on its own with a button, not
 * with the settings form's autosave: a half-typed time would change every pace.
 */
function RaceResultField({
  idPrefix,
  raceResult,
}: {
  idPrefix: string;
  raceResult: RaceResult | null;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [metres, setMetres] = useState<number>(RACE_DISTANCES[2]);
  const [time, setTime] = useState("");
  const [date, setDate] = useState(todayKey);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: RaceResult | null) => saveRaceResult({ data: { raceResult: next } }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(trainingPacesQueryOptions.queryKey, saved);
      setTime("");
      setInvalid(null);
      await queryClient.invalidateQueries({ queryKey: seasonQueryOptions.queryKey });
    },
  });

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
    setInvalid(null);
    save.mutate(parsed.data);
  }

  const id = (name: string) => `${idPrefix}-race-${name}`;

  return (
    <FieldSet>
      <FieldLegend>Race result</FieldLegend>
      <FieldDescription>
        A recent race or all-out time trial on a flat road. It sets your paces in place of the
        estimate until you clear it.
      </FieldDescription>
      {raceResult ? (
        <Field orientation="horizontal" className="flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums">{raceLine(raceResult)}</span>
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
    </FieldSet>
  );
}
