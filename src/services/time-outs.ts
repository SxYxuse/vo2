import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { addDayKey } from "./day-key.ts";
import { daysBetween } from "./season.types.ts";

/** Days the athlete can't train because they are sick or injured (ADR 0066). */
export type TimeOut = {
  id: string;
  kind: "sick" | "injured";
  /** Day keys in the athlete's time zone; no end while the time out lasts. */
  start: string;
  end: string | null;
};

export type TimeOutsData = { signedIn: boolean; timeOuts: TimeOut[] };

export const TIME_OUT_KINDS = [
  { id: "sick", label: "Sick" },
  { id: "injured", label: "Injured" },
] as const satisfies { id: TimeOut["kind"]; label: string }[];

/** How far back and ahead a time out may start: four weeks either side (ADR 0066). */
const WINDOW_DAYS = 28;

/** The first and last day a time out may start, from today and this training week's Monday. */
export function timeOutStartWindow(today: string, weekStart: string) {
  return { first: addDayKey(weekStart, -WINDOW_DAYS), last: addDayKey(today, WINDOW_DAYS) };
}

/** Whether a time out covers a day; an open one covers every day from its start. */
export function timeOutCovers(timeOut: Pick<TimeOut, "start" | "end">, day: string) {
  return day >= timeOut.start && (timeOut.end == null || day <= timeOut.end);
}

/**
 * The time outs as the coach reads them, in the plan writer's prompt and the chat's context: kind,
 * days, how many days off, and how long ago the athlete came back (ADR 0066). An open one, or one
 * still ahead, has no return yet.
 */
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

/**
 * Whether the athlete is on this time out with no end yet: while one is, the coach plan writes
 * nothing (ADR 0066). One ahead isn't open yet.
 */
export function timeOutOpen(timeOut: Pick<TimeOut, "start" | "end">, today: string) {
  return timeOut.end == null && timeOut.start <= today;
}

/** Time outs shade the fitness chart and mark calendar days in a colour no sport or series uses. */
export const TIME_OUT_COLOR = "var(--color-ds-purple-700)";

/**
 * Which time out a calendar day falls in, or null. An open one marks its days up to today, or only
 * its first day while it is still ahead: what follows isn't known yet.
 */
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

/**
 * Why a time out can't be saved among the athlete's others, or null. The start window is only
 * held when the start is new, so an older time out can still be edited or ended.
 */
export function timeOutProblem(
  candidate: Pick<TimeOut, "start" | "end">,
  others: Pick<TimeOut, "start" | "end">[],
  window: { first: string; last: string } | null,
) {
  if (window && candidate.start < window.first) {
    return "A time out can start at most four weeks before this training week.";
  }
  if (window && candidate.start > window.last) {
    return "A time out can start at most four weeks from today.";
  }
  if (candidate.end != null && candidate.end < candidate.start) {
    return "The end can't be before the start.";
  }
  if (candidate.end == null && others.some((other) => other.end == null)) {
    return "You already have a time out with no end. End it first.";
  }
  if (others.some((other) => overlaps(candidate, other))) {
    return "These days overlap another time out.";
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
  /** The device's, where the athlete reads today and this training week. */
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

/** "I'm back": the time out ends yesterday, or goes when it started today or later. */
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
