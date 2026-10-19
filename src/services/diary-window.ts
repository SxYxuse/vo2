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

export function isTrainingWeekStartKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

export function parseDiaryWeekSearch(value: unknown) {
  return isTrainingWeekStartKey(value) ? value : undefined;
}

export function resolveDiaryCursorWeek(requestedWeek: string | undefined, currentWeek: string) {
  return requestedWeek && requestedWeek <= currentWeek ? requestedWeek : currentWeek;
}
