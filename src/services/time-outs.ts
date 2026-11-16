import { createServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { z } from "zod";

import { addDayKey } from "./day-key.ts";
import { daysBetween } from "./season.types.ts";

export type TimeOut = {
  id: string;
  kind: "sick" | "injured";
  start: string;
  end: string | null;
};

export type TimeOutsData = { signedIn: boolean; timeOuts: TimeOut[] };

export const TIME_OUT_KINDS = [
  { id: "sick", label: "Sick" },
  { id: "injured", label: "Injured" },
] as const satisfies { id: TimeOut["kind"]; label: string }[];

const WINDOW_DAYS = 28;

export function timeOutStartWindow(today: string, weekStart: string) {
  return { first: addDayKey(weekStart, -WINDOW_DAYS), last: addDayKey(today, WINDOW_DAYS) };
}

export function timeOutCovers(timeOut: Pick<TimeOut, "start" | "end">, day: string) {
  return day >= timeOut.start && (timeOut.end == null || day <= timeOut.end);
}

export function timeOutsBetween(timeOuts: TimeOut[], first: string, last: string) {
  return timeOuts.flatMap((timeOut) => {
    const from = timeOut.start > first ? timeOut.start : first;
    const to = timeOut.end != null && timeOut.end < last ? timeOut.end : last;
    return from > to ? [] : [{ timeOut, from, to }];
  });
}

export function timeOutsForCoach(
  timeOuts: Pick<TimeOut, "kind" | "start" | "end">[],
  today: string,
) {
  return timeOuts.map(({ kind, start, end }) => {
    const returned = end != null && end < today;
    return {
      kind,
      start,
      end,
      state: start > today ? "ahead" : returned ? "over" : "now",
      daysOff: end == null ? null : daysBetween(start, end) + 1,
      daysSinceReturn: returned ? daysBetween(end, today) - 1 : null,
    };
  });
}

export function timeOutOpen(timeOut: Pick<TimeOut, "start" | "end">, today: string) {
  return timeOut.end == null && timeOut.start <= today;
}

export const timeOutDay = (key: string) => format(parseISO(key), "EEE d MMM");

export function timeOutSpan(start: string, end: string) {
  if (start === end) return format(parseISO(start), "d MMM");
  const from = parseISO(start);
  const to = parseISO(end);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${format(from, sameMonth ? "d" : "d MMM")}–${format(to, "d MMM")}`;
}

export const timeOutKind = (timeOut: Pick<TimeOut, "kind">) =>
  TIME_OUT_KINDS.find((kind) => kind.id === timeOut.kind)?.label ?? "";

export function timeOutOnDay(timeOuts: TimeOut[], day: string, today: string) {
  return (
    timeOuts.find((timeOut) =>
      timeOutCovers(
        {
          start: timeOut.start,
          end: timeOut.end ?? (today > timeOut.start ? today : timeOut.start),
        },
        day,
      ),
    ) ?? null
  );
}

function overlaps(a: Pick<TimeOut, "start" | "end">, b: Pick<TimeOut, "start" | "end">) {
  return (b.end == null || a.start <= b.end) && (a.end == null || b.start <= a.end);
}

export function timeOutProblem(
  candidate: Pick<TimeOut, "start" | "end">,
  others: Pick<TimeOut, "start" | "end">[],
  window: { first: string; last: string } | null,
) {
  if (window && candidate.start < window.first) {
    return "It can start at most four weeks before this training week.";
  }
  if (window && candidate.start > window.last) {
    return "It can start at most four weeks from today.";
  }
  if (candidate.end != null && candidate.end < candidate.start) {
    return "The end can't be before the start.";
  }
  if (candidate.end == null && others.some((other) => other.end == null)) {
    return "You're already sick or injured with no end. End that first.";
  }
  if (others.some((other) => overlaps(candidate, other))) {
    return "These days overlap others you marked sick or injured.";
  }
  return null;
}

const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeZoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
});
const timeOutInputSchema = z.object({
  kind: z.enum(["sick", "injured"]),
  start: dayKeySchema,
  end: dayKeySchema.nullable(),
  timeZone: timeZoneSchema,
});
export type TimeOutInput = z.infer<typeof timeOutInputSchema>;

export const listTimeOuts = createServerFn({ method: "GET" }).handler(
  async (): Promise<TimeOutsData> => {
    const { listTimeOutsImpl } = await import("./time-outs.server.ts");
    return listTimeOutsImpl();
  },
);

export const createTimeOut = createServerFn({ method: "POST" })
  .validator(timeOutInputSchema)
  .handler(async ({ data }): Promise<void> => {
    const { createTimeOutImpl } = await import("./time-outs.server.ts");
    await createTimeOutImpl(data);
  });

export const updateTimeOut = createServerFn({ method: "POST" })
  .validator(timeOutInputSchema.extend({ id: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const { updateTimeOutImpl } = await import("./time-outs.server.ts");
    await updateTimeOutImpl(data);
  });

export const endTimeOut = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), timeZone: timeZoneSchema }))
  .handler(async ({ data }): Promise<void> => {
    const { endTimeOutImpl } = await import("./time-outs.server.ts");
    await endTimeOutImpl(data.id, data.timeZone);
  });

export const deleteTimeOut = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const { deleteTimeOutImpl } = await import("./time-outs.server.ts");
    await deleteTimeOutImpl(data.id);
  });
