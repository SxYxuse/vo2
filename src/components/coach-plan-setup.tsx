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
  DEFAULT_AVAILABILITY,
  MAX_SESSIONS_PER_SPORT,
  planSportOf,
  type Availability,
  type CoachPlanMissing,
  type CoachPlanState,
  type PlanSport,
} from "@/services/coach-plan.types.ts";
import { createGoal } from "@/services/season.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { ProgressionSettings, savedProgressionKey } from "@/components/progression-settings.tsx";
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

const SPORT_FIELDS = [
  { sport: "run", key: "runsPerWeek", legend: "Runs a week", noun: "runs" },
  { sport: "ride", key: "ridesPerWeek", legend: "Rides a week", noun: "rides" },
] as const;

/**
 * Availability (ADR 0048, ADR 0050): how many runs and rides a week. The coach writes each week's
 * sessions, and the athlete picks the days to do them. 0 plans none of that sport.
 */
export function AvailabilityFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
  disabled?: boolean;
}) {
  const issue = availabilityIssue(value);
  return (
    <FieldGroup>
      <FieldDescription>
        The coach writes that many runs and rides each week. You pick the days to do them. 0 plans
        none of that sport.
      </FieldDescription>
      {SPORT_FIELDS.map((field) => (
        <FieldSet key={field.key}>
          <FieldLegend variant="label">{field.legend}</FieldLegend>
          <ToggleGroup
            variant="outline"
            spacing={1}
            className="grid w-full grid-cols-7"
            disabled={disabled}
            value={[String(value[field.key])]}
            onValueChange={(next) => {
              const picked = (next as string[])[0];
              if (picked != null) onChange({ ...value, [field.key]: Number(picked) });
            }}
          >
            {Array.from({ length: MAX_SESSIONS_PER_SPORT + 1 }, (_, count) => (
              <ToggleGroupItem
                key={count}
                value={String(count)}
                aria-label={`${count} ${field.noun} a week`}
                className="w-full"
              >
                {count}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      ))}
      {issue ? <FieldError>{issue}</FieldError> : null}
    </FieldGroup>
  );
}

/** Availability with the A goal's sport planned: a first ride goal asks for rides, not runs. */
export function availabilityForGoal(value: Availability, goalSportType: string | undefined) {
  const sport = goalSportType ? planSportOf(goalSportType) : null;
  if (sport === "ride" && value.ridesPerWeek === 0) return { ...value, ridesPerWeek: 3 };
  if (sport === "run" && value.runsPerWeek === 0) return { ...value, runsPerWeek: 3 };
  return value;
}

const MISSING: Record<CoachPlanMissing, { text: string; link: ReactNode }> = {
  key: {
    text: "The coach writes the plan on your own key.",
    link: (
      <Link to="/settings/$section" params={{ section: "coach" }} className="underline">
        Add your key in Settings → Coach
      </Link>
    ),
  },
  goal: {
    text: "The plan builds toward an upcoming A goal: a run or a ride with a distance.",
    link: (
      <Link to="/season" className="underline">
        Add one in Season
      </Link>
    ),
  },
  availability: {
    text: "The coach needs to know how many times a week you run and ride.",
    link: (
      <Link to="/settings/$section" params={{ section: "training" }} className="underline">
        Set it in Settings → Training
      </Link>
    ),
  },
  goalSport: {
    text: "Your A goal's sport has no sessions a week, so nothing would build toward it.",
    link: (
      <Link to="/settings/$section" params={{ section: "training" }} className="underline">
        Add some in Settings → Training
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

const DISTANCES: Record<PlanSport, { label: string; metres: number }[]> = {
  run: [
    { label: "5 km", metres: 5000 },
    { label: "10 km", metres: 10_000 },
    { label: "Half", metres: 21_097.5 },
    { label: "Marathon", metres: 42_195 },
  ],
  ride: [
    { label: "50 km", metres: 50_000 },
    { label: "100 km", metres: 100_000 },
    { label: "160 km", metres: 160_000 },
    { label: "200 km", metres: 200_000 },
  ],
};

const GOAL_SPORT_TYPE = { run: "Run", ride: "Ride" } as const satisfies Record<PlanSport, string>;

function formatKm(metres: number) {
  return `${Math.round(metres / 100) / 10} km`;
}

/**
 * The A goal the coach plan builds toward, or a short form to add one: a run or a ride, its date
 * and distance. As an A race, it is saved to perform (ADR 0049). Climbing and more goals are
 * added in Season.
 */
export function CoachPlanGoalField({ state }: { state: CoachPlanState | undefined }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [sport, setSport] = useState<PlanSport>("run");
  const [metres, setMetres] = useState<number>(DISTANCES.run[1]!.metres);
  const add = useMutation({
    mutationFn: () =>
      createGoal({
        data: {
          name: name.trim(),
          sportType: GOAL_SPORT_TYPE[sport],
          date,
          distanceM: metres,
          elevationGainM: null,
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
          {state.aGoal.date} · {formatKm(state.aGoal.distanceM ?? 0)}
          {planSportOf(state.aGoal.sportType) === "ride" ? " ride" : " run"}. The plan builds toward
          it, and toward the rest of your season. Change it anytime in Season.
        </AlertDescription>
      </Alert>
    );
  }
  const today = state.today;
  const ready = name.trim().length > 0 && date > today;
  return (
    <FieldGroup>
      <FieldDescription>
        The coach plan builds toward an A race: a run or a ride with a distance. Add yours here; you
        can add more goals, of either sport, in Season later.
      </FieldDescription>
      <FieldSet>
        <FieldLegend variant="label">Sport</FieldLegend>
        <ToggleGroup
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-2"
          value={[sport]}
          onValueChange={(next) => {
            const picked = (next as string[])[0] as PlanSport | undefined;
            if (!picked) return;
            setSport(picked);
            setMetres(DISTANCES[picked][1]!.metres);
          }}
        >
          <ToggleGroupItem value="run" className="w-full">
            Run
          </ToggleGroupItem>
          <ToggleGroupItem value="ride" className="w-full">
            Ride
          </ToggleGroupItem>
        </ToggleGroup>
      </FieldSet>
      <Field>
        <FieldLabel htmlFor="coach-goal-name">Race name</FieldLabel>
        <Input
          id="coach-goal-name"
          value={name}
          maxLength={120}
          placeholder={sport === "ride" ? "Mountain gran fondo" : "City half marathon"}
          onChange={(event) => setName(event.target.value)}
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
          {DISTANCES[sport].map((distance) => (
            <ToggleGroupItem
              key={distance.label}
              value={String(distance.metres)}
              className="w-full"
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
 * Settings → Training under the coach plan: what's missing, availability, progression, and where
 * the plan stands. Availability saves with its own button: each save can rewrite the weeks ahead on the
 * athlete's key, so it shouldn't save one tap at a time.
 */
export function CoachPlanSettings() {
  const online = useOnline();
  const { data: state } = useQuery(coachPlanQueryOptions);
  const saved = state?.availability ?? null;
  const [draft, setDraft] = useState<Availability>(saved ?? DEFAULT_AVAILABILITY);
  const goalSportType = state?.aGoal?.sportType;
  useEffect(() => {
    if (saved) setDraft(saved);
    else setDraft((current) => availabilityForGoal(current, goalSportType));
  }, [saved, goalSportType]);
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
      <AvailabilityFields value={draft} onChange={setDraft} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
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
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {!online
            ? "Offline: availability can't be saved."
            : save.error
              ? "Could not save. Nothing was saved."
              : saved
                ? coachPlanStatusText(state)
                : null}
        </p>
      </div>
      {state.volume ? (
        <>
          <FieldSeparator />
          <ProgressionSettings key={savedProgressionKey(state.volume)} state={state} />
        </>
      ) : null}
      {state.plan || state.status === "writing" ? (
        <Button variant="outline" nativeButton={false} render={<Link to="/week" />}>
          Open your plan
        </Button>
      ) : null}
    </FieldGroup>
  );
}
