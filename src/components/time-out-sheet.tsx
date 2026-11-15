"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ThermometerIcon, XIcon } from "lucide-react";
import { cn } from "cn";

import { DatePicker } from "@/components/date-picker.tsx";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useOnline } from "@/hooks/use-online.ts";
import { afterTimeOutsChanged } from "@/lib/query-events.ts";
import { firstWeekBack } from "@/services/coach-plan-budget.ts";
import { dayKey, weekStartKey } from "@/services/day-key.ts";
import { daysBetween } from "@/services/season.types.ts";
import {
  TIME_OUT_KINDS,
  createTimeOut,
  deleteTimeOut,
  endTimeOut,
  timeOutDay,
  timeOutKind,
  timeOutOpen,
  timeOutStartWindow,
  updateTimeOut,
  type TimeOut,
} from "@/services/time-outs.ts";

/** A time out to edit, "new" to mark one, or null when the sheet is closed. */
export type TimeOutEditing = TimeOut | "new" | null;

/** Every button of the feature fits its text and stays a thumb's height (AGENTS.md). */
const TOUCH = "min-h-[2.75rem]";

/**
 * Marks, edits, ends, or deletes a time out (ADR 0066): a bottom sheet on phones, a dialog on
 * desktop. Athletes see its kind, "Sick" or "Injured"; "time out" is the glossary's word.
 */
export function TimeOutSheet({
  editing,
  onClose,
}: {
  editing: TimeOutEditing;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialog open={editing != null} onOpenChange={(open) => (open ? null : onClose())}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        {editing ? (
          <TimeOutForm
            key={editing === "new" ? "new" : editing.id}
            timeOut={editing === "new" ? null : editing}
            onDone={onClose}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The time out the athlete is on, or the next one ahead, if any. */
export function currentTimeOut(timeOuts: TimeOut[], today: string) {
  return timeOuts.find((item) => item.end == null || item.end >= today) ?? null;
}

/**
 * Plan's banner for the time out the athlete is on, or the next one ahead (ADR 0066). While one
 * lasts it owns the page: the day count, what the return looks like, and "I'm back". One ahead is
 * quieter, with only "Edit".
 */
export function TimeOutBanner({
  timeOut,
  today,
  onEdit,
}: {
  timeOut: TimeOut;
  today: string;
  onEdit: (timeOut: TimeOut) => void;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [timeZone] = useState(deviceTimeZone);
  const back = useMutation({
    mutationFn: (id: string) => endTimeOut({ data: { id, timeZone } }),
    onSuccess: () => afterTimeOutsChanged(queryClient),
  });
  const kind = timeOutKind(timeOut);
  const started = timeOut.start <= today;
  const edit = (
    <Button
      type="button"
      variant="link"
      className={cn(TOUCH, "px-1")}
      onClick={() => onEdit(timeOut)}
    >
      Edit
    </Button>
  );

  if (!started) {
    return (
      <section
        aria-label={kind}
        className="ring-foreground/10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2 ring-1"
      >
        <span aria-hidden className="hatch-time-out size-5 shrink-0 rounded-sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-sm font-medium">
            {kind} from {timeOutDay(timeOut.start)}
            {timeOut.end ? ` to ${timeOutDay(timeOut.end)}` : ""}
          </h2>
          <p className="text-muted-foreground text-xs">The weeks it covers will be lighter.</p>
        </div>
        {edit}
      </section>
    );
  }

  // "I'm back" ends it yesterday, so the days off are the ones before today.
  const day = daysBetween(timeOut.start, today) + 1;
  const share = Math.round(firstWeekBack(Math.max(1, day - 1)) * 100);
  return (
    <section aria-label={kind} className="bg-muted flex flex-col gap-1.5 rounded-xl p-4">
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <ThermometerIcon aria-hidden className="size-3.5" />
        {kind} · day {day}
      </p>
      <h2 className="text-lg font-semibold">
        {timeOut.end == null
          ? `${kind} since ${timeOutDay(timeOut.start)}`
          : `${kind} until ${timeOutDay(timeOut.end)}`}
      </h2>
      <p className="text-muted-foreground text-sm">
        {timeOut.end == null
          ? `Your coach plan is paused. When you're back, your first week is ${share} % of a normal one, then it climbs.`
          : "This week's training is cut for the days it holds."}
      </p>
      {back.error ? <p className="text-destructive text-sm">{back.error.message}</p> : null}
      <div className="mt-1 flex items-center gap-3">
        <Button
          type="button"
          className={TOUCH}
          disabled={!online || back.isPending}
          onClick={() => back.mutate(timeOut.id)}
        >
          {back.isPending ? <Spinner data-icon="inline-start" /> : null}
          {"I'm back"}
        </Button>
        {edit}
      </div>
    </section>
  );
}

function TimeOutForm({ timeOut, onDone }: { timeOut: TimeOut | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [timeZone] = useState(deviceTimeZone);
  const [now] = useState(() => new Date());
  const today = dayKey(now, timeZone);
  const window = timeOutStartWindow(today, weekStartKey(now, timeZone));
  const [kind, setKind] = useState<TimeOut["kind"]>(timeOut?.kind ?? "sick");
  const [start, setStart] = useState(timeOut?.start ?? today);
  const [end, setEnd] = useState<string | null>(timeOut?.end ?? null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const done = async () => {
    await afterTimeOutsChanged(queryClient);
    onDone();
  };
  const save = useMutation({
    mutationFn: async () => {
      const data = { kind, start, end, timeZone };
      if (timeOut) await updateTimeOut({ data: { ...data, id: timeOut.id } });
      else await createTimeOut({ data });
    },
    onSuccess: done,
  });
  const back = useMutation({
    mutationFn: () => endTimeOut({ data: { id: timeOut!.id, timeZone } }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => deleteTimeOut({ data: { id: timeOut!.id } }),
    onSuccess: done,
  });
  const pending = save.isPending || back.isPending || remove.isPending;
  const error = save.error ?? back.error ?? remove.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Sick or injured</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          {"Mark the days you can't train."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-0">
        <FieldGroup>
          <ToggleGroup
            aria-label="Kind"
            spacing={0}
            value={[kind]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "sick" || value === "injured") setKind(value);
            }}
            className="bg-muted grid w-full grid-cols-2 gap-0 rounded-lg p-1"
          >
            {TIME_OUT_KINDS.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                className="data-[pressed]:bg-background min-h-[2.75rem] rounded-md! border-0 text-sm data-[pressed]:shadow-sm"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Field>
            <FieldLabel htmlFor="time-out-start">From</FieldLabel>
            <DatePicker
              id="time-out-start"
              value={start}
              // An older time out keeps its start; a new start is held to the window.
              fromDate={timeOut && timeOut.start < window.first ? timeOut.start : window.first}
              toDate={window.last}
              display={timeOutDay}
              className={TOUCH}
              invalid={false}
              onChange={(next) => {
                setStart(next);
                if (end != null && end < next) setEnd(next);
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="time-out-end">Until</FieldLabel>
            <div className="flex gap-1">
              <DatePicker
                id="time-out-end"
                value={end ?? ""}
                fromDate={start}
                placeholder="Still going · leave empty"
                display={timeOutDay}
                className={TOUCH}
                invalid={false}
                onChange={setEnd}
              />
              {end != null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-[2.75rem]"
                  aria-label="Clear the end"
                  onClick={() => setEnd(null)}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
            <FieldDescription>Your coach plan pauses while it lasts.</FieldDescription>
          </Field>
          {online ? null : (
            <Alert>
              <AlertDescription>Saving needs a connection.</AlertDescription>
            </Alert>
          )}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </div>
      <ResponsiveDialogFooter className="flex-col items-stretch gap-0 sm:flex-col">
        <div className="flex items-center gap-3">
          <Button type="submit" className={TOUCH} disabled={!online || pending}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
          {timeOut && timeOutOpen(timeOut, today) ? (
            <Button
              type="button"
              variant="outline"
              className={TOUCH}
              disabled={!online || pending}
              onClick={() => back.mutate()}
            >
              {back.isPending ? <Spinner data-icon="inline-start" /> : null}
              {"I'm back"}
            </Button>
          ) : null}
        </div>
        {timeOut ? (
          <div className="mt-4 border-t pt-2">
            <Button
              type="button"
              variant="link"
              className={cn(TOUCH, "text-destructive px-0")}
              disabled={!online || pending}
              onClick={() => (confirmingDelete ? remove.mutate() : setConfirmingDelete(true))}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {confirmingDelete ? "Delete for good" : "Delete"}
            </Button>
          </div>
        ) : null}
      </ResponsiveDialogFooter>
    </form>
  );
}
