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
