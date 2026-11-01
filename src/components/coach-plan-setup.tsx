"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarCheckIcon, FlagIcon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachPlanQueryOptions, seasonQueryOptions } from "@/lib/queries.ts";
import { saveCoachPlanAvailability } from "@/services/coach-plan.ts";
import {
  availabilitySchema,
  DAY_MINUTE_CHOICES,
  DEFAULT_AVAILABILITY,
  MAX_RUNS_PER_WEEK,
  MIN_RUNS_PER_WEEK,
  type Availability,
  type CoachPlanMissing,
  type CoachPlanState,
} from "@/services/coach-plan.types.ts";
import { createGoal } from "@/services/season.ts";
import { WEEKDAYS } from "@/services/training-plan.types.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The athlete's time zone travels with availability, so "today" is theirs on the server. */
export function useSaveAvailability(onSaved?: (state: CoachPlanState) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (availability: Availability) =>
      saveCoachPlanAvailability({ data: { availability, timeZone: timeZone() } }),
    onSuccess: (state) => {
      queryClient.setQueryData(coachPlanQueryOptions.queryKey, state);
      onSaved?.(state);
    },
  });
}

/** The first problem with an availability, in words, or null when it can be saved. */
export function availabilityIssue(value: Availability) {
  const parsed = availabilitySchema.safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check your availability.");
}

/**
 * Availability (ADR 0037): runs a week, the days the athlete can run with the time they have on
 * each, and the long run day. The plan picks which of the days to use.
 */
export function AvailabilityFields({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: {
  idPrefix: string;
  value: Availability;
  onChange: (next: Availability) => void;
  disabled?: boolean;
}) {
  const chosen = WEEKDAYS.filter((day) => value.days.some((item) => item.weekday === day.id));
  const issue = availabilityIssue(value);
  const setDays = (weekdays: number[]) => {
    const days = WEEKDAYS.filter((day) => weekdays.includes(day.id)).map((day) => ({
      weekday: day.id,
      minutes: value.days.find((item) => item.weekday === day.id)?.minutes ?? 60,
    }));
    const longRunDay = weekdays.includes(value.longRunDay)
      ? value.longRunDay
      : (days.at(-1)?.weekday ?? value.longRunDay);
    onChange({ ...value, days, longRunDay });
  };

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Runs a week</FieldLegend>
        <ToggleGroup
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-5"
          disabled={disabled}
          value={[String(value.runsPerWeek)]}
          onValueChange={(next) => {
            const picked = (next as string[])[0];
            if (picked != null) onChange({ ...value, runsPerWeek: Number(picked) });
          }}
        >
          {Array.from({ length: MAX_RUNS_PER_WEEK - MIN_RUNS_PER_WEEK + 1 }, (_, index) => {
            const runs = String(MIN_RUNS_PER_WEEK + index);
            return (
              <ToggleGroupItem
                key={runs}
                value={runs}
                aria-label={`${runs} runs a week`}
                className="min-h-11 w-full"
              >
                {runs}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Days you can run</FieldLegend>
        <FieldDescription>
          Pick at least as many days as runs. The coach chooses which of them to use.
        </FieldDescription>
        <ToggleGroup
          multiple
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-7"
          disabled={disabled}
          value={chosen.map((day) => String(day.id))}
          onValueChange={(next) => setDays((next as string[]).map(Number))}
        >
          {WEEKDAYS.map((day) => (
            <ToggleGroupItem
              key={day.id}
              value={String(day.id)}
              aria-label={day.label}
              className="min-h-11 w-full px-0"
            >
              {day.label.slice(0, 2)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>

      {chosen.length ? (
        <FieldSet>
          <FieldLegend>Time you have</FieldLegend>
          <div className="flex flex-col gap-2">
            {chosen.map((day) => {
              const id = `${idPrefix}-minutes-${day.id}`;
              const minutes = value.days.find((item) => item.weekday === day.id)!.minutes;
              return (
                <Field key={day.id} orientation="horizontal" className="items-center">
                  <FieldLabel htmlFor={id} className="flex-1">
                    {day.label}
                  </FieldLabel>
                  <NativeSelect
                    id={id}
                    className="w-32"
                    disabled={disabled}
                    value={String(minutes)}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        days: value.days.map((item) =>
                          item.weekday === day.id
                            ? { ...item, minutes: Number(event.target.value) }
                            : item,
                        ),
                      })
                    }
                  >
                    {DAY_MINUTE_CHOICES.map((choice) => (
                      <NativeSelectOption key={choice} value={String(choice)}>
                        {choice < 60
                          ? `${choice} min`
                          : `${Math.floor(choice / 60)} h${choice % 60 ? ` ${choice % 60}` : ""}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              );
            })}
          </div>
        </FieldSet>
      ) : null}

      {chosen.length ? (
        <FieldSet>
          <FieldLegend>Long run day</FieldLegend>
          <ToggleGroup
            variant="outline"
            spacing={1}
            className="flex-wrap"
            disabled={disabled}
            value={[String(value.longRunDay)]}
            onValueChange={(next) => {
              const picked = (next as string[])[0];
              if (picked != null) onChange({ ...value, longRunDay: Number(picked) });
            }}
          >
            {chosen.map((day) => (
              <ToggleGroupItem
                key={day.id}
                value={String(day.id)}
                aria-label={`Long run on ${day.label}`}
                className="min-h-11"
              >
                {day.label.slice(0, 3)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      ) : null}
      {issue ? <FieldError>{issue}</FieldError> : null}
    </FieldGroup>
  );
}

const MISSING: Record<CoachPlanMissing, { text: string; link: ReactNode }> = {
  key: {
    text: "The coach writes the plan on your own OpenRouter key.",
    link: (
      <Link to="/settings/$section" params={{ section: "coach" }} className="underline">
        Add your key in Settings → Coach
      </Link>
    ),
  },
  goal: {
    text: "The plan builds toward an upcoming A goal: a run with a distance.",
    link: (
      <Link to="/season" className="underline">
        Add one in Season
      </Link>
    ),
  },
  availability: {
    text: "The coach needs to know when you can run.",
    link: (
      <Link to="/settings/$section" params={{ section: "training" }} className="underline">
        Set it in Settings → Training
      </Link>
    ),
  },
};

/** What the coach plan still needs, each with the way to fix it. */
export function CoachPlanMissingAlert({ missing }: { missing: CoachPlanMissing[] }) {
  if (!missing.length) return null;
  return (
    <Alert>
      <AlertTitle>The coach plan can't be written yet</AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 ps-4">
          {missing.map((item) => (
            <li key={item}>
              {MISSING[item].text} {MISSING[item].link}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

const DISTANCES = [
  { label: "5 km", metres: 5000 },
  { label: "10 km", metres: 10_000 },
  { label: "Half", metres: 21_097.5 },
  { label: "Marathon", metres: 42_195 },
] as const;

function formatKm(metres: number) {
  return `${Math.round(metres / 100) / 10} km`;
}

/**
 * The A goal the coach plan builds toward, or a short form to add one: a run, its date and
 * distance. Objective is left out: with the coach plan goals are saved as perform.
 */
export function CoachPlanGoalField({ state }: { state: CoachPlanState | undefined }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [metres, setMetres] = useState<number>(DISTANCES[1].metres);
  const add = useMutation({
    mutationFn: () =>
      createGoal({
        data: {
          name: name.trim(),
          sportType: "Run",
          date,
          distanceM: metres,
          elevationGainM: null,
          objective: "perform",
          priority: "A",
        },
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries(coachPlanQueryOptions),
        queryClient.invalidateQueries(seasonQueryOptions),
      ]),
  });
  if (!state) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (state.aGoal) {
    return (
      <Alert>
        <FlagIcon />
        <AlertTitle>{state.aGoal.name}</AlertTitle>
        <AlertDescription>
          {state.aGoal.date} · {formatKm(state.aGoal.distanceM ?? 0)}. The plan builds toward it.
          Change it anytime in Season.
        </AlertDescription>
      </Alert>
    );
  }
  const today = state.today;
  const ready = name.trim().length > 0 && date > today;
  return (
    <FieldGroup>
      <FieldDescription>
        The coach plan builds toward an A race: a run with a distance. Add yours here; you can add
        more goals in Season later.
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="coach-goal-name">Race name</FieldLabel>
        <Input
          id="coach-goal-name"
          value={name}
          maxLength={120}
          placeholder="City half marathon"
          onChange={(event) => setName(event.target.value)}
          className="min-h-10"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="coach-goal-date">Race date</FieldLabel>
        <Input
          id="coach-goal-date"
          type="date"
          min={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="min-h-10"
        />
      </Field>
      <FieldSet>
        <FieldLegend>Distance</FieldLegend>
        <ToggleGroup
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-4"
          value={[String(metres)]}
          onValueChange={(next) => {
            const picked = (next as string[])[0];
            if (picked != null) setMetres(Number(picked));
          }}
        >
          {DISTANCES.map((distance) => (
            <ToggleGroupItem
              key={distance.label}
              value={String(distance.metres)}
              className="min-h-11 w-full"
            >
              {distance.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>
      <Button
        type="button"
        variant="outline"
        disabled={!ready || add.isPending}
        onClick={() => add.mutate()}
      >
        {add.isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <FlagIcon data-icon="inline-start" />
        )}
        Add A race
      </Button>
      {add.error ? <FieldError>Could not add the race. Try again.</FieldError> : null}
    </FieldGroup>
  );
}

/** Where the plan stands: being written, failed with why, or written. */
export function coachPlanStatusText(state: CoachPlanState) {
  if (state.status === "writing") return "Writing your plan…";
  if (state.status === "failed") return `Failed: ${state.error ?? "try again"}`;
  if (state.plan) return `Written ${new Date(state.plan.writtenAt).toLocaleString()}`;
  return "Not written yet";
}

/**
 * Settings → Training under the coach plan: what's missing, availability, and where the plan
 * stands. Availability saves with its own button: each save can rewrite the weeks ahead on the
 * athlete's key, so it shouldn't save one tap at a time.
 */
export function CoachPlanSettings() {
  const online = useOnline();
  const { data: state } = useQuery(coachPlanQueryOptions);
  const saved = state?.availability ?? null;
  const [draft, setDraft] = useState<Availability>(saved ?? DEFAULT_AVAILABILITY);
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const save = useSaveAvailability();
  const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  if (!state) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const missing = state.missing.filter((item) => item !== "availability");
  return (
    <FieldGroup>
      <CoachPlanMissingAlert missing={missing} />
      {state.aGoal ? (
        <FieldDescription>
          Building toward <strong>{state.aGoal.name}</strong> on {state.aGoal.date}.
        </FieldDescription>
      ) : null}
      <AvailabilityFields idPrefix="settings" value={draft} onChange={setDraft} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          className="min-h-10 sm:min-h-8"
          disabled={!online || !changed || availabilityIssue(draft) != null || save.isPending}
          onClick={() => save.mutate(draft)}
        >
          {save.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <CalendarCheckIcon data-icon="inline-start" />
          )}
          {saved ? "Save and rewrite plan" : "Save availability"}
        </Button>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {!online
            ? "Offline: availability can't be saved."
            : save.error
              ? "Could not save. Nothing was saved."
              : saved
                ? coachPlanStatusText(state)
                : null}
        </p>
      </div>
      {state.plan || state.status === "writing" ? (
        <Button variant="outline" nativeButton={false} render={<Link to="/week" />}>
          Open your plan
        </Button>
      ) : null}
    </FieldGroup>
  );
}
