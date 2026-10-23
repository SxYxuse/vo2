"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { addYears, format, parseISO } from "date-fns";
import {
  CalendarIcon,
  ChevronRightIcon,
  ClipboardPasteIcon,
  CopyIcon,
  EllipsisIcon,
  FlagIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";

import { afterGoalsChanged } from "@/lib/query-events.ts";
import { formatDistanceKm, formatElevation } from "@/services/activity-detail.types.ts";
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { createEvent, createGoal, deleteGoal, pasteSeason, updateGoal } from "@/services/season.ts";
import {
  GOAL_OBJECTIVES,
  GOAL_PRIORITIES,
  LEG_SEPARATOR,
  daysBetween,
  eventPriority,
  eventTitle,
  formatDaysLeft,
  goalInputSchema,
  seasonCopy,
  seasonCopySchema,
  type Goal,
  type GoalInput,
  type PastGoal,
  type SeasonData,
  type SeasonEvent,
} from "@/services/season.types.ts";
import { sportGroupFor } from "@/services/sport-groups.ts";
import { PhaseBadge, PriorityBadge, SeasonMap, phaseOutlook } from "@/components/season-map.tsx";
import { SPORT_STYLE } from "@/components/sport-style.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const objectiveLabel = (id: Goal["objective"]) =>
  GOAL_OBJECTIVES.find((objective) => objective.id === id)?.label ?? id;

const formatGoalDate = (key: string) => format(parseISO(key), "EEE d MMM yyyy");

/** Metres of climbing per km from which a goal reads as hilly, as the plan treats it. */
const HILLY_M_PER_KM = 15;

function goalFacts(goal: Goal) {
  return [
    formatSportType(goal.sportType),
    goal.distanceM != null ? formatDistanceKm(goal.distanceM) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function isHilly(goal: Goal) {
  return (
    goal.distanceM != null &&
    goal.elevationGainM != null &&
    goal.elevationGainM / (goal.distanceM / 1000) >= HILLY_M_PER_KM
  );
}

/** Which dialog is open: a new goal (optionally on a date) or an existing one. */
type Editing = { goal: Goal | null } | null;

export function SeasonView({ data }: { data: SeasonData }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [pasting, setPasting] = useState(false);
  const open = (goal: Goal | null) => setEditing({ goal });
  const outlook = phaseOutlook(data.map);
  const allGoals = [...data.upcoming.flatMap((event) => event.goals), ...data.past];

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(seasonCopy(allGoals)));
      toast.add({
        type: "success",
        title: "Season copied",
        description: `${allGoals.length} goals. Open Season in the other VO2 and paste them there.`,
      });
    } catch {
      toast.add({ type: "error", title: "Could not copy the season" });
    }
  }

  return (
    <>
      <div className="flex justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" aria-label="More season actions" />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!allGoals.length} onClick={() => void copy()}>
              <CopyIcon />
              Copy season
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPasting(true)}>
              <ClipboardPasteIcon />
              Paste season
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <>
          {data.map.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  Season map
                  {data.map[0] ? (
                    <PhaseBadge kind={data.map[0].kind} lighter={data.map[0].lighter} />
                  ) : null}
                </CardTitle>
                <CardDescription>
                  {outlook}. Bars are the weekly hours if you hit each target; tap one to see its
                  week.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SeasonMap weeks={data.map} events={data.upcoming} />
              </CardContent>
            </Card>
          ) : null}
          <section className="flex flex-col gap-3" aria-label="Upcoming goals">
            {data.upcoming.map((event) => (
              <EventCard key={event.date} event={event} data={data} onEdit={open} />
            ))}
          </section>
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">A</span> races get the full build, peak,
            and taper. <span className="text-foreground font-medium">B</span> races get a few
            lighter days and no recovery week.{" "}
            <span className="text-foreground font-medium">C</span> races are trained through. Tap a
            goal to change it.
          </p>
        </>
      )}

      {data.past.length > 0 ? <PastGoals goals={data.past} today={data.today} /> : null}

      <GoalDialog
        editing={editing}
        today={data.today}
        sportTypes={data.sportTypes}
        onClose={() => setEditing(null)}
      />
      <PasteSeasonDialog open={pasting} onClose={() => setPasting(false)} />
    </>
  );
}

function PasteSeasonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <ResponsiveDialogContent className="sm:max-w-md">
        {open ? <PasteSeasonBody onDone={onClose} /> : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function PasteSeasonBody({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const paste = useMutation({
    mutationFn: async () => {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("This isn't a copied season. Use Copy season in the other VO2.");
      }
      const parsed = seasonCopySchema.safeParse(json);
      if (!parsed.success) {
        throw new Error("This isn't a copied season. Use Copy season in the other VO2.");
      }
      return pasteSeason({ data: parsed.data });
    },
    onSuccess: async ({ added, skipped }) => {
      await afterGoalsChanged(queryClient);
      toast.add({
        type: "success",
        title: added ? `${added} goals added` : "Nothing new to add",
        description: skipped ? `${skipped} were already on your season.` : undefined,
      });
      onDone();
    },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        paste.mutate();
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Paste a season</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Paste what Copy season gave you in the other VO2. Goals you already have are skipped.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-0">
        <FieldGroup>
          <Field data-invalid={paste.error != null}>
            <FieldLabel htmlFor="season-paste">Copied season</FieldLabel>
            <Textarea
              id="season-paste"
              autoComplete="off"
              spellCheck={false}
              placeholder='{"vo2Season":1,"goals":[…]}'
              className="max-h-48 font-mono"
              value={text}
              aria-invalid={paste.error != null}
              onChange={(event) => setText(event.target.value)}
            />
            <FieldError>{paste.error?.message}</FieldError>
          </Field>
        </FieldGroup>
      </div>
      <ResponsiveDialogFooter>
        <Button type="submit" disabled={!text.trim() || paste.isPending} className="h-10 sm:h-7">
          {paste.isPending ? <Spinner data-icon="inline-start" /> : null}
          Add goals
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** One race or event: priority, countdown, and legs. */
function EventCard({
  event,
  data,
  onEdit,
}: {
  event: SeasonEvent;
  data: SeasonData;
  onEdit: (goal: Goal) => void;
}) {
  const priority = eventPriority(event);
  // Each leg opens on its own, so only a single-leg event can make the whole card its button.
  const whole = event.goals.length === 1;

  return (
    <article
      className={cn(
        "flex flex-col gap-1 rounded-xl border px-3 py-2.5",
        whole && "hover:bg-muted/50 relative",
      )}
    >
      <div className="flex min-h-8 items-center gap-2">
        <PriorityBadge priority={priority} />
        <h2 className="min-w-0 flex-1 truncate font-medium">{eventTitle(event)}</h2>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatDaysLeft(daysBetween(data.today, event.date))}
        </span>
      </div>
      <p className="text-muted-foreground text-xs tabular-nums">
        {formatGoalDate(event.date)} · {objectiveLabel(event.goals[0]!.objective)}
      </p>
      <ul className="-mx-2 flex flex-col">
        {event.goals.map((goal) => {
          const group = sportGroupFor(goal.sportType)?.id;
          const Icon = group ? SPORT_STYLE[group].icon : FlagIcon;
          return (
            <li key={goal.id}>
              <button
                type="button"
                onClick={() => onEdit(goal)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm",
                  whole
                    ? "focus-visible:after:ring-ring/50 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px]"
                    : "hover:bg-muted/50",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn("size-4 shrink-0", group ? SPORT_STYLE[group].text : "")}
                />
                <span className="min-w-0 flex-1 truncate">
                  {goalFacts(goal)}
                  {goal.elevationGainM ? ` · ${formatElevation(goal.elevationGainM)} D+` : ""}
                  {isHilly(goal) ? " (hilly)" : ""}
                </span>
                <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </article>
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

function GoalDatePicker({
  id,
  value,
  fromDate,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  fromDate?: string;
  invalid: boolean;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  const from = fromDate ? parseISO(fromDate) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={invalid}
            className="h-10 w-full justify-start font-normal sm:h-7"
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {selected ? (
          format(selected, "d MMM yyyy")
        ) : (
          <span className="text-muted-foreground">Pick a date</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected ?? from}
          startMonth={from}
          endMonth={addYears(new Date(), 5)}
          disabled={from ? { before: from } : undefined}
          onSelect={(next) => {
            if (!next) return;
            onChange(format(next, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** One sport of an event; a triathlon has three. */
type LegForm = { sportType: string; distanceKm: string; elevationGainM: string };

type GoalForm = LegForm & {
  name: string;
  date: string;
  objective: Goal["objective"];
  priority: Goal["priority"];
  /** Further sports on the same day, for a new multisport event. */
  legs: LegForm[];
};

function formFor(goal: Goal | null, defaultSportType: string): GoalForm {
  return {
    name: goal?.name ?? "",
    sportType: goal?.sportType ?? defaultSportType,
    date: goal?.date ?? "",
    distanceKm: goal?.distanceM != null ? String(goal.distanceM / 1000) : "",
    elevationGainM: goal?.elevationGainM != null ? String(goal.elevationGainM) : "",
    objective: goal?.objective ?? "finishWell",
    priority: goal?.priority ?? "A",
    legs: [],
  };
}

/** Text, not number inputs: comma-decimal keyboards can't type "42.2" into a number input. */
function parseOptionalNumber(value: string) {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toInput(form: GoalForm, leg: LegForm = form, name = form.name) {
  const distanceKm = parseOptionalNumber(leg.distanceKm);
  return goalInputSchema.safeParse({
    name,
    sportType: leg.sportType,
    date: form.date,
    distanceM: distanceKm == null ? null : distanceKm * 1000,
    elevationGainM: parseOptionalNumber(leg.elevationGainM),
    objective: form.objective,
    priority: form.priority,
  });
}

/** "Ironman WA · Swim": the event's name with the leg's sport. */
function legName(form: GoalForm, leg: LegForm) {
  return `${form.name.trim()}${LEG_SEPARATOR}${formatSportType(leg.sportType)}`;
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
  const [step, setStep] = useState<"details" | "priority">("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const parsed = toInput(form);
  const issues = parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );
  const errorFor = (key: keyof GoalInput) => (submitted ? issues[key] : undefined);
  const set = (next: Partial<GoalForm>) => setForm((current) => ({ ...current, ...next }));
  const setLeg = (index: number, next: Partial<LegForm>) =>
    setForm((current) => ({
      ...current,
      legs: current.legs.map((leg, at) => (at === index ? { ...leg, ...next } : leg)),
    }));

  const save = useMutation({
    mutationFn: async (data: GoalInput) => {
      if (goal) await updateGoal({ data: { ...data, id: goal.id } });
      else if (form.legs.length) {
        const legs = [form, ...form.legs].map((leg) => toInput(form, leg, legName(form, leg)));
        if (legs.some((leg) => !leg.success)) throw new Error("Check each sport's distance.");
        await createEvent({ data: { legs: legs.map((leg) => leg.data!) } });
      } else await createGoal({ data });
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
    if (!parsed.success) return;
    if (step === "details") setStep("priority");
    else save.mutate(parsed.data);
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{goal ? "Edit goal" : "Add a goal"}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {step === "details"
            ? "Step 1 of 2 · The race or event: what, when, and how far."
            : "Step 2 of 2 · How much it matters. The plan builds toward your next A race."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div key={step} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-0">
        <FieldGroup>
          {step === "details" ? (
            <>
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
                  <Select
                    value={form.sportType}
                    onValueChange={(next) => {
                      if (next != null) set({ sportType: String(next) });
                    }}
                  >
                    <SelectTrigger
                      id="goal-sport"
                      className="w-full data-[size=default]:h-10 sm:data-[size=default]:h-7"
                    >
                      <SelectValue>{formatSportType(form.sportType)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {sportOptions.map((type) => (
                          <SelectItem key={type} value={type}>
                            {formatSportType(type)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={errorFor("date") != null}>
                  <FieldLabel htmlFor="goal-date">Date</FieldLabel>
                  <GoalDatePicker
                    id="goal-date"
                    value={form.date}
                    // A new goal is ahead; an existing one may be moved to any date.
                    fromDate={goal ? undefined : today}
                    invalid={errorFor("date") != null}
                    onChange={(date) => set({ date })}
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
              {!goal ? (
                <div className="flex flex-col gap-3">
                  {form.legs.map((leg, index) => (
                    // Legs are positional: the order is the race order.
                    // oxlint-disable-next-line react/no-array-index-key
                    <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">Then</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove sport ${index + 2}`}
                          onClick={() => set({ legs: form.legs.filter((_, at) => at !== index) })}
                        >
                          <XIcon />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Select
                          value={leg.sportType}
                          onValueChange={(next) => {
                            if (next != null) setLeg(index, { sportType: String(next) });
                          }}
                        >
                          <SelectTrigger
                            aria-label={`Sport ${index + 2}`}
                            className="w-full data-[size=default]:h-10 sm:data-[size=default]:h-7"
                          >
                            <SelectValue>{formatSportType(leg.sportType)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {sportOptions.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {formatSportType(type)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <InputGroup className="h-10 sm:h-7 [&_input]:h-full">
                          <InputGroupInput
                            aria-label={`Distance ${index + 2}`}
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="10"
                            value={leg.distanceKm}
                            onChange={(event) => setLeg(index, { distanceKm: event.target.value })}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>km</InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                        <InputGroup className="h-10 sm:h-7 [&_input]:h-full">
                          <InputGroupInput
                            aria-label={`Elevation gain ${index + 2}`}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="0"
                            value={leg.elevationGainM}
                            onChange={(event) =>
                              setLeg(index, { elevationGainM: event.target.value })
                            }
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>m</InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                      </div>
                    </div>
                  ))}
                  {form.legs.length < 4 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10 self-start sm:h-7"
                      onClick={() =>
                        set({
                          legs: [
                            ...form.legs,
                            { sportType: form.sportType, distanceKm: "", elevationGainM: "" },
                          ],
                        })
                      }
                    >
                      <PlusIcon data-icon="inline-start" />
                      Add another sport, same day
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <FieldSet>
                <FieldLegend variant="label">Priority</FieldLegend>
                <RadioGroup
                  name="goal-priority"
                  value={form.priority}
                  onValueChange={(next) => {
                    if (next) set({ priority: next as Goal["priority"] });
                  }}
                  className="gap-2"
                >
                  {GOAL_PRIORITIES.map((priority) => {
                    const id = `goal-priority-${priority.id}`;
                    return (
                      <FieldLabel key={priority.id} htmlFor={id} className="w-full">
                        <Field orientation="horizontal" className="items-start p-3">
                          <RadioGroupItem value={priority.id} id={id} />
                          <FieldContent>
                            <FieldTitle>{priority.label}</FieldTitle>
                            <FieldDescription>{priority.hint}</FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                    );
                  })}
                </RadioGroup>
              </FieldSet>
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
                        <Field orientation="horizontal" className="items-start p-3">
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
            </>
          )}
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
          {step === "details" ? "Next" : goal ? "Save" : "Add goal"}
        </Button>
        {step === "priority" ? (
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setStep("details")}
            className="h-10 sm:order-first sm:h-7"
          >
            Back
          </Button>
        ) : goal ? (
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
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
              className="h-10 sm:order-first sm:mr-auto sm:h-7"
            >
              Delete
            </Button>
          )
        ) : null}
      </ResponsiveDialogFooter>
    </form>
  );
}
