import { dayKey } from "./training-plan.types.ts";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** `YYYY-MM` of a date in the athlete's timezone. */
export function monthKey(date: Date, timeZone: string) {
  return dayKey(date, timeZone).slice(0, 7);
}

/** Moves the cursor one month, never past the current month. */
export function stepDiaryMonth(cursorMonth: string, direction: 1 | -1, currentMonth: string) {
  const [year, month] = cursorMonth.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + direction, 1)).toISOString().slice(0, 7);
  return next > currentMonth ? currentMonth : next;
}

/** Reads a `?month=` value: `YYYY-MM`, or nothing. */
export function parseDiaryMonthSearch(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return undefined;
  return value;
}

/** The diary's cursor month from the URL, never past the current month. */
export function resolveDiaryCursorMonth(requestedMonth: string | undefined, currentMonth: string) {
  return requestedMonth && requestedMonth <= currentMonth ? requestedMonth : currentMonth;
}

/** "October 2026". */
export function formatDiaryMonth(month: string) {
  const [year, index] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, index - 1, 1)));
}
