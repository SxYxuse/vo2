"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ThermometerIcon, XIcon } from "lucide-react";

import { DatePicker } from "@/components/date-picker.tsx";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { useOnline } from "@/hooks/use-online.ts";
import { afterTimeOutsChanged } from "@/lib/query-events.ts";
import { dayKey, weekStartKey } from "@/services/day-key.ts";
import {
  TIME_OUT_KINDS,
  createTimeOut,
  deleteTimeOut,
  endTimeOut,
  timeOutCovers,
  timeOutStartWindow,
  updateTimeOut,
  type TimeOut,
} from "@/services/time-outs.ts";

/** A time out to edit, "new" to mark one, or null when the sheet is closed. */
export type TimeOutEditing = TimeOut | "new" | null;

/**
 * Marks, edits, ends, or deletes a time out (ADR 0066): a bottom sheet on phones, a dialog on
 * desktop.
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
      <ResponsiveDialogContent className="sm:max-w-md">
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

const formatDay = (key: string) => format(parseISO(key), "EEE d MMM");

/**
 * Plan's banner for the time out the athlete is on, or the next one ahead (ADR 0066): while it is
 * open the coach plan is paused, and "I'm back" starts it again.
 */
export function TimeOutBanner({
  timeOuts,
  onEdit,
}: {
  timeOuts: TimeOut[];
  onEdit: (timeOut: TimeOut) => void;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [timeZone] = useState(deviceTimeZone);
  const today = dayKey(new Date(), timeZone);
  const timeOut = timeOuts.find((item) => item.end == null || item.end >= today);
  const back = useMutation({
    mutationFn: (id: string) => endTimeOut({ data: { id, timeZone } }),
    onSuccess: () => afterTimeOutsChanged(queryClient),
  });
  if (!timeOut) return null;
  const current = timeOut.start <= today;
  const kind = TIME_OUT_KINDS.find((item) => item.id === timeOut.kind)?.label ?? "";
  const title = !current
    ? `Time out from ${formatDay(timeOut.start)}${timeOut.end ? ` to ${formatDay(timeOut.end)}` : ""}`
    : timeOut.end == null
      ? `On time out since ${formatDay(timeOut.start)}`
      : `On time out until ${formatDay(timeOut.end)}`;
  const description = !current
    ? "The weeks it covers get less training, by the days it holds."
    : timeOut.end == null
      ? "Your coach plan is paused. Tap I'm back when you can train again."
      : "This week's training is cut for the days it holds.";
  return (
    <Alert>
      <ThermometerIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {kind}. {description}
        {back.error ? <span className="text-destructive block">{back.error.message}</span> : null}
      </AlertDescription>
      <AlertAction className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(timeOut)}>
          Edit
        </Button>
        {current ? (
          <Button
            type="button"
            size="sm"
            disabled={!online || back.isPending}
            onClick={() => back.mutate(timeOut.id)}
          >
            {back.isPending ? <Spinner data-icon="inline-start" /> : null}
            {"I'm back"}
          </Button>
        ) : null}
      </AlertAction>
    </Alert>
  );
}

function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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
        <ResponsiveDialogTitle>
          {timeOut ? "Edit time out" : "Sick or injured"}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {"Mark the days you can't train. Leave the end empty while it lasts."}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-0">
        <FieldGroup>
          <FieldSet>
            <FieldLegend variant="label">Kind</FieldLegend>
            <RadioGroup
              name="time-out-kind"
              value={kind}
              onValueChange={(next) => {
                if (next === "sick" || next === "injured") setKind(next);
              }}
              className="grid grid-cols-2 gap-2"
            >
              {TIME_OUT_KINDS.map((option) => (
                <FieldLabel
                  key={option.id}
                  htmlFor={`time-out-kind-${option.id}`}
                  className="min-h-[2.75rem] w-full items-center gap-2 rounded-lg border px-3"
                >
                  <RadioGroupItem value={option.id} id={`time-out-kind-${option.id}`} />
                  {option.label}
                </FieldLabel>
              ))}
            </RadioGroup>
          </FieldSet>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="time-out-start">Start</FieldLabel>
              <DatePicker
                id="time-out-start"
                value={start}
                // An older time out keeps its start; a new start is held to the window.
                fromDate={timeOut && timeOut.start < window.first ? timeOut.start : window.first}
                toDate={window.last}
                invalid={false}
                onChange={(next) => {
                  setStart(next);
                  if (end != null && end < next) setEnd(next);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="time-out-end">End</FieldLabel>
              <div className="flex gap-1">
                <DatePicker
                  id="time-out-end"
                  value={end ?? ""}
                  fromDate={start}
                  placeholder="Not yet"
                  invalid={false}
                  onChange={setEnd}
                />
                {end != null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Clear the end"
                    onClick={() => setEnd(null)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
          {online ? null : (
            <Alert>
              <AlertDescription>Saving a time out needs a connection.</AlertDescription>
            </Alert>
          )}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </div>
      <ResponsiveDialogFooter>
        <Button type="submit" disabled={!online || pending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
        {timeOut && timeOutCovers(timeOut, today) ? (
          <Button
            type="button"
            variant="outline"
            disabled={!online || pending}
            onClick={() => back.mutate()}
            className="sm:order-first"
          >
            {back.isPending ? <Spinner data-icon="inline-start" /> : null}
            {"I'm back"}
          </Button>
        ) : null}
        {timeOut ? (
          <Button
            type="button"
            variant="destructive"
            disabled={!online || pending}
            onClick={() => (confirmingDelete ? remove.mutate() : setConfirmingDelete(true))}
            className="sm:order-first sm:mr-auto"
          >
            {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
            {confirmingDelete ? "Delete for good" : "Delete"}
          </Button>
        ) : null}
      </ResponsiveDialogFooter>
    </form>
  );
}
