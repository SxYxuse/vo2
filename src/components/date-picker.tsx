"use client";

import { useState } from "react";
import { addYears, format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A day key ("2026-10-30") picked from a calendar, optionally between two days. */
export function DatePicker({
  id,
  value,
  fromDate,
  toDate,
  placeholder = "Pick a date",
  display = (key) => format(parseISO(key), "d MMM yyyy"),
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  fromDate?: string;
  toDate?: string;
  placeholder?: string;
  /** How the picked day reads on the button. */
  display?: (key: string) => string;
  invalid: boolean;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  const from = fromDate ? parseISO(fromDate) : undefined;
  const to = toDate ? parseISO(toDate) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={invalid}
            className="w-full justify-start font-normal"
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {value ? display(value) : <span className="text-muted-foreground">{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected ?? from}
          startMonth={from}
          endMonth={to ?? addYears(new Date(), 5)}
          disabled={[...(from ? [{ before: from }] : []), ...(to ? [{ after: to }] : [])]}
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
