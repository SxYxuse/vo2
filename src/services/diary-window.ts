import { addDayKey } from "./training-plan.types.ts";

export type DiaryScope = "four-weeks" | "week";

export const DIARY_SCOPES: Array<{ value: DiaryScope; label: string; weeks: number }> = [
  { value: "four-weeks", label: "4 weeks", weeks: 4 },
  { value: "week", label: "Week", weeks: 1 },
];

export function diaryWeekCount(scope: DiaryScope) {
  return DIARY_SCOPES.find((option) => option.value === scope)?.weeks ?? 1;
}

/** Day keys covered by the diary: the cursor training week and the weeks before it. */
export function diaryWindow(cursorWeek: string, scope: DiaryScope) {
  const days = diaryWeekCount(scope) * 7;
  const start = addDayKey(cursorWeek, 7 - days);
  return { start, end: addDayKey(cursorWeek, 6), days };
}

/** Moves the cursor one training week, never past the current training week. */
export function stepDiaryWeek(cursorWeek: string, direction: 1 | -1, currentWeek: string) {
  const next = addDayKey(cursorWeek, direction * 7);
  return next > currentWeek ? currentWeek : next;
}
