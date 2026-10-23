"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { ChevronRightIcon, FlagIcon, PlusIcon } from "lucide-react";

import { afterGoalsChanged } from "@/lib/query-events.ts";
import { formatDistanceKm, formatElevation } from "@/services/activity-detail.types.ts";
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { createGoal, deleteGoal, pickMainGoal, updateGoal } from "@/services/season.ts";
import {
  CLUSTER_GAP_DAYS,
  GOAL_OBJECTIVES,
  daysBetween,
  formatDaysLeft,
  goalInputSchema,
  type Goal,
  type GoalInput,
  type PastGoal,
  type SeasonCluster,
  type SeasonData,
  type SeasonEvent,
} from "@/services/season.types.ts";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";

const objectiveLabel = (id: Goal["objective"]) =>
  GOAL_OBJECTIVES.find((objective) => objective.id === id)?.label ?? id;

const formatGoalDate = (key: string) => format(parseISO(key), "EEE d MMM yyyy");

function goalFacts(goal: Goal) {
  return [
    formatSportType(goal.sportType),
    goal.distanceM != null ? formatDistanceKm(goal.distanceM) : null,
    goal.elevationGainM ? `${formatElevation(goal.elevationGainM)} D+` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Which dialog is open: a new goal (optionally on a date) or an existing one. */
type Editing = { goal: Goal | null } | null;

export function SeasonView({ data }: { data: SeasonData }) {
  const [editing, setEditing] = useState<Editing>(null);
  const open = (goal: Goal | null) => setEditing({ goal });

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => open(null)}>
          <PlusIcon data-icon="inline-start" />
          Add a goal
        </Button>
      </div>

      {data.upcoming.length === 0 ? (
        <Empty className="min-h-56 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>No goals ahead</EmptyTitle>
            <EmptyDescription>
              Add the races and events of your season. Without one, the plan holds your fitness.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => open(null)}>
              <PlusIcon data-icon="inline-start" />
              Add a goal
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Upcoming goals">
          {data.upcoming.map((cluster) => (
            <ClusterCard
              key={cluster.events[0]!.date}
              cluster={cluster}
              today={data.today}
              onEdit={open}
            />
          ))}
        </section>
      )}

      {data.past.length > 0 ? <PastGoals goals={data.past} today={data.today} /> : null}

      <GoalDialog
        editing={editing}
        today={data.today}
        sportTypes={data.sportTypes}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ClusterCard({
  cluster,
  today,
  onEdit,
}: {
  cluster: SeasonCluster;
  today: string;
  onEdit: (goal: Goal) => void;
}) {
  const queryClient = useQueryClient();
  const pick = useMutation({
    mutationFn: (id: string) => pickMainGoal({ data: { id } }),
    onSettled: () => afterGoalsChanged(queryClient),
  });
  const several = cluster.events.length > 1;

  if (!several) {
    return (
      <div className="rounded-xl border">
        <EventRows event={cluster.events[0]!} today={today} onEdit={onEdit} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Which one do you peak for?</p>
        <p className="text-muted-foreground text-xs">
          These are less than {CLUSTER_GAP_DAYS / 7} weeks apart, so the plan fully tapers for one.
          The others get a short taper and a few easy days after.
          {cluster.chosen ? "" : " VO2 picked the longest."}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {cluster.events.map((event) => {
          const isMain = event.date === cluster.mainDate;
          return (
            <li
              key={event.date}
              className={isMain ? "border-primary rounded-lg border" : "rounded-lg border"}
            >
              <EventRows event={event} today={today} onEdit={onEdit} />
              <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5">
                {isMain ? (
                  <Badge>Peak</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">Tune-up</span>
                )}
                {isMain ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 sm:min-h-8"
                    disabled={pick.isPending}
                    onClick={() => pick.mutate(event.goals[0]!.id)}
                  >
                    {pick.isPending && pick.variables === event.goals[0]!.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    Peak for this one
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {pick.error ? <p className="text-destructive text-sm">{pick.error.message}</p> : null}
    </div>
  );
}

function EventRows({
  event,
  today,
  onEdit,
}: {
  event: SeasonEvent;
  today: string;
  onEdit: (goal: Goal) => void;
}) {
  return (
    <ul className="flex flex-col divide-y">
      {event.goals.map((goal) => (
        <li key={goal.id}>
          <button
            type="button"
            onClick={() => onEdit(goal)}
            className="hover:bg-muted/50 flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-start"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{goal.name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatGoalDate(goal.date)} · {goalFacts(goal)}
              </span>
              <span className="text-muted-foreground text-xs">
                {objectiveLabel(goal.objective)}
              </span>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatDaysLeft(daysBetween(today, goal.date))}
            </span>
            <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function PastGoals({ goals, today }: { goals: PastGoal[]; today: string }) {
  return (
    <section className="flex flex-col gap-2" aria-label="Past goals">
      <h2 className="text-sm font-medium">Past goals</h2>
      <ul className="flex flex-col divide-y rounded-xl border">
        {goals.map((goal) => {
          const body = (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{goal.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatGoalDate(goal.date)} · {goalFacts(goal)}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatDaysLeft(daysBetween(today, goal.date))}
              </span>
            </>
          );
          return (
            <li key={goal.id}>
              {goal.activityId ? (
                <Link
                  to="/activities/$activityId"
                  params={{ activityId: goal.activityId }}
                  preload="intent"
                  className="hover:bg-muted/50 flex min-h-14 items-center gap-3 px-3 py-2.5"
                >
                  {body}
                  <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </Link>
              ) : (
                <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type GoalForm = {
  name: string;
  sportType: string;
  date: string;
  distanceKm: string;
  elevationGainM: string;
  objective: Goal["objective"];
};

function formFor(goal: Goal | null, defaultSportType: string): GoalForm {
  return {
    name: goal?.name ?? "",
    sportType: goal?.sportType ?? defaultSportType,
    date: goal?.date ?? "",
    distanceKm: goal?.distanceM != null ? String(goal.distanceM / 1000) : "",
    elevationGainM: goal?.elevationGainM != null ? String(goal.elevationGainM) : "",
    objective: goal?.objective ?? "finishWell",
  };
}

/** Text, not number inputs: comma-decimal keyboards can't type "42.2" into a number input. */
function parseOptionalNumber(value: string) {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toInput(form: GoalForm) {
  const distanceKm = parseOptionalNumber(form.distanceKm);
  return goalInputSchema.safeParse({
    name: form.name,
    sportType: form.sportType,
    date: form.date,
    distanceM: distanceKm == null ? null : distanceKm * 1000,
    elevationGainM: parseOptionalNumber(form.elevationGainM),
    objective: form.objective,
  });
}

function GoalDialog({
  editing,
  today,
  sportTypes,
  onClose,
}: {
  editing: Editing;
  today: string;
  sportTypes: string[];
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={editing != null} onOpenChange={(open) => (open ? null : onClose())}>
      <ResponsiveDialogContent className="sm:max-w-md">
        {editing ? (
          <GoalFormBody
            key={editing.goal?.id ?? "new"}
            goal={editing.goal}
            today={today}
            sportTypes={sportTypes}
            onDone={onClose}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function GoalFormBody({
  goal,
  today,
  sportTypes,
  onDone,
}: {
  goal: Goal | null;
  today: string;
  sportTypes: string[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // A goal keeps its sport even after the athlete hides it in Settings.
  const sportOptions =
    goal && !sportTypes.includes(goal.sportType) ? [goal.sportType, ...sportTypes] : sportTypes;
  const [form, setForm] = useState(() => formFor(goal, sportOptions[0] ?? "Run"));
  const [submitted, setSubmitted] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const parsed = toInput(form);
  const issues = parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );
  const errorFor = (key: keyof GoalInput) => (submitted ? issues[key] : undefined);
  const set = (next: Partial<GoalForm>) => setForm((current) => ({ ...current, ...next }));

  const save = useMutation({
    mutationFn: async (data: GoalInput) => {
      if (goal) await updateGoal({ data: { ...data, id: goal.id } });
      else await createGoal({ data });
    },
    onSuccess: async () => {
      await afterGoalsChanged(queryClient);
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteGoal({ data: { id: goal!.id } }),
    onSuccess: async () => {
      await afterGoalsChanged(queryClient);
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (parsed.success) save.mutate(parsed.data);
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{goal ? "Edit goal" : "Add a goal"}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          A race or event on your season. The plan works toward your goals in date order.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-0">
        <FieldGroup>
          <Field data-invalid={errorFor("name") != null}>
            <FieldLabel htmlFor="goal-name">Name</FieldLabel>
            <Input
              id="goal-name"
              autoComplete="off"
              placeholder="Trail des Fagnes"
              className="h-10 sm:h-7"
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
            />
            <FieldError>{errorFor("name")}</FieldError>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="goal-sport">Sport</FieldLabel>
              <NativeSelect
                id="goal-sport"
                className="w-full [&_select]:h-10 sm:[&_select]:h-7"
                value={form.sportType}
                onChange={(event) => set({ sportType: event.target.value })}
              >
                {sportOptions.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {formatSportType(type)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field data-invalid={errorFor("date") != null}>
              <FieldLabel htmlFor="goal-date">Date</FieldLabel>
              <Input
                id="goal-date"
                type="date"
                min={goal ? undefined : today}
                className="h-10 sm:h-7"
                value={form.date}
                onChange={(event) => set({ date: event.target.value })}
              />
              <FieldError>{errorFor("date")}</FieldError>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field data-invalid={errorFor("distanceM") != null}>
              <FieldLabel htmlFor="goal-distance">Distance</FieldLabel>
              <InputGroup className="h-10 sm:h-7 [&_input]:h-full">
                <InputGroupInput
                  id="goal-distance"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="42.2"
                  value={form.distanceKm}
                  onChange={(event) => set({ distanceKm: event.target.value })}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>km</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldError>{errorFor("distanceM")}</FieldError>
            </Field>
            <Field data-invalid={errorFor("elevationGainM") != null}>
              <FieldLabel htmlFor="goal-elevation">Elevation gain</FieldLabel>
              <InputGroup className="h-10 sm:h-7 [&_input]:h-full">
                <InputGroupInput
                  id="goal-elevation"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  value={form.elevationGainM}
                  onChange={(event) => set({ elevationGainM: event.target.value })}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>m</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldError>{errorFor("elevationGainM")}</FieldError>
            </Field>
          </div>
          <FieldSet>
            <FieldLegend variant="label">Objective</FieldLegend>
            <RadioGroup
              name="goal-objective"
              value={form.objective}
              onValueChange={(next) => {
                if (next) set({ objective: next as Goal["objective"] });
              }}
              className="gap-2"
            >
              {GOAL_OBJECTIVES.map((objective) => {
                const id = `goal-objective-${objective.id}`;
                return (
                  <FieldLabel key={objective.id} htmlFor={id} className="w-full">
                    <Field orientation="horizontal" className="items-start rounded-lg border p-3">
                      <RadioGroupItem value={objective.id} id={id} />
                      <FieldContent>
                        <FieldTitle>{objective.label}</FieldTitle>
                        <FieldDescription>{objective.hint}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                );
              })}
            </RadioGroup>
          </FieldSet>
          {save.error || remove.error ? (
            <Alert variant="destructive">
              <AlertDescription>{(save.error ?? remove.error)?.message}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </div>
      <ResponsiveDialogFooter>
        <Button type="submit" disabled={save.isPending} className="h-10 sm:h-7">
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          {goal ? "Save" : "Add goal"}
        </Button>
        {goal ? (
          confirmingDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="h-10 sm:order-first sm:mr-auto sm:h-7"
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              Delete for good
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              className="text-destructive h-10 sm:order-first sm:mr-auto sm:h-7"
            >
              Delete
            </Button>
          )
        ) : null}
      </ResponsiveDialogFooter>
    </form>
  );
}
