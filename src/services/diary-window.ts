import { addDayKey, dayKey, weekStartKey } from "./training-plan.types.ts";

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

/** Day keys covered by the diary: the cursor training week and the weeks before it. */
export function diaryWindow(cursorWeek: string, weeks: number) {
  const days = weeks * 7;
  return { start: addDayKey(cursorWeek, 7 - days), end: addDayKey(cursorWeek, 6), days };
}

/** Moves the cursor by whole training weeks, never past the current training week. */
export function stepDiaryWeek(
  cursorWeek: string,
  direction: 1 | -1,
  currentWeek: string,
  weeks = 1,
) {
  const next = addDayKey(cursorWeek, direction * weeks * 7);
  return next > currentWeek ? currentWeek : next;
}

/** Reads a `?week=` value: a Monday day key, or nothing. */
export function parseDiaryWeekSearch(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  const isMonday = date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
  return isMonday ? value : undefined;
}

/** The diary's cursor week from the URL, never past the current training week. */
export function resolveDiaryCursorWeek(requestedWeek: string | undefined, currentWeek: string) {
  return requestedWeek && requestedWeek <= currentWeek ? requestedWeek : currentWeek;
}

/** The training week holding a month's last day, to keep the place when switching views. */
export function lastWeekOfMonth(month: string) {
  const [year, index] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, index, 0));
  const offset = (lastDay.getUTCDay() + 6) % 7;
  return addDayKey(lastDay.toISOString().slice(0, 10), -offset);
}

/** The training week holding a month's 1st. */
export function firstWeekOfMonth(month: string) {
  const firstDay = new Date(`${month}-01T00:00:00Z`);
  const offset = (firstDay.getUTCDay() + 6) % 7;
  return addDayKey(`${month}-01`, -offset);
}

/** Cursor for a month picked in the week views: its weeks read from the top, never past now. */
export function monthLandingWeek(month: string, weeks: number, currentWeek: string) {
  const last = addDayKey(firstWeekOfMonth(month), (weeks - 1) * 7);
  return last > currentWeek ? currentWeek : last;
}

/** Training weeks that touch a month, oldest first, never past the current week. */
export function trainingWeeksOfMonth(month: string, currentWeek: string) {
  const weeks: string[] = [];
  const last = lastWeekOfMonth(month);
  for (let week = firstWeekOfMonth(month); week <= last && week <= currentWeek;) {
    weeks.push(week);
    week = addDayKey(week, 7);
  }
  return weeks;
}

/** Activity count and moving time per month, moving time per training week, for the jump picker. */
export function diaryTotals(
  activities: readonly { start: string; movingTime: number }[],
  timeZone: string,
) {
  const months = new Map<string, { count: number; movingTime: number }>();
  const weeks = new Map<string, number>();
  let oldestMonth: string | undefined;
  for (const activity of activities) {
    const start = new Date(activity.start);
    const month = monthKey(start, timeZone);
    const total = months.get(month) ?? { count: 0, movingTime: 0 };
    months.set(month, {
      count: total.count + 1,
      movingTime: total.movingTime + activity.movingTime,
    });
    const week = weekStartKey(start, timeZone);
    weeks.set(week, (weeks.get(week) ?? 0) + activity.movingTime);
    if (!oldestMonth || month < oldestMonth) oldestMonth = month;
  }
  return { months, weeks, oldestMonth };
}

export type DiaryTotals = ReturnType<typeof diaryTotals>;

/** The month a training week ends in. */
export function monthOfWeek(week: string) {
  return addDayKey(week, 6).slice(0, 7);
}

/** "Sep 28 – Oct 25, 2026". */
export function formatDiaryRange(start: string, end: string) {
  const [fromYear, fromMonth, fromDay] = start.split("-").map(Number);
  const [toYear, toMonth, toDay] = end.split("-").map(Number);
  const day = (year: number, month: number, date: number, withYear: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, date)));
  const sameYear = fromYear === toYear;
  const right =
    sameYear && fromMonth === toMonth ? `${toDay}, ${toYear}` : day(toYear, toMonth, toDay, true);
  return `${day(fromYear, fromMonth, fromDay, !sameYear)} – ${right}`;
}

/** Where the calendar was: a past `?month=` or a past `?week=`. The present has neither. */
export type DiarySearch = { month?: string; week?: string };

export function parseDiarySearch(search: Record<string, unknown>): DiarySearch {
  const month = parseDiaryMonthSearch(search.month);
  const week = parseDiaryWeekSearch(search.week);
  return { ...(month ? { month } : {}), ...(week ? { week } : {}) };
}
