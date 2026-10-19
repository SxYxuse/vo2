import { addDayKey } from "./training-plan.types.ts";

/** Day keys covered by the diary: the cursor training week and the weeks before it. */
export function diaryWindow(cursorWeek: string, weeks: number) {
  const days = weeks * 7;
  const start = addDayKey(cursorWeek, 7 - days);
  return { start, end: addDayKey(cursorWeek, 6), days };
}

/** Moves the cursor one training week, never past the current training week. */
export function stepDiaryWeek(cursorWeek: string, direction: 1 | -1, currentWeek: string) {
  const next = addDayKey(cursorWeek, direction * 7);
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
