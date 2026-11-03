"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Button } from "@/components/ui/button";
import {
  diaryWindow,
  formatDiaryMonth,
  formatDiaryRange,
  trainingWeeksOfMonth,
  type DiaryTotals,
} from "@/services/diary-window.ts";

/** "45 min", "2h", "1h 30". */
function formatHours(hours: number) {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type DiaryJumpPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totals: DiaryTotals;
  oldestMonth: string;
  cursorMonth: string;
  currentMonth: string;
  currentWeek: string;
  /** Phones pick a training week after the month; desktop shows the month itself. */
  pickWeek: boolean;
  onPickMonth: (month: string) => void;
  onPickWeek: (week: string) => void;
};

/** Year → month (→ training week) picker behind the calendar's date label (ADR 0022). */
export function DiaryJumpPicker({
  open,
  onOpenChange,
  totals,
  oldestMonth,
  cursorMonth,
  currentMonth,
  currentWeek,
  pickWeek,
  onPickMonth,
  onPickWeek,
}: DiaryJumpPickerProps) {
  const oldestYear = Number(oldestMonth.slice(0, 4));
  const currentYear = Number(currentMonth.slice(0, 4));
  // The parent remounts the picker on every open, so it starts on the cursor's year.
  const [year, setYear] = useState(() =>
    Math.min(currentYear, Math.max(oldestYear, Number(cursorMonth.slice(0, 4)))),
  );
  const [month, setMonth] = useState<string | null>(null);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {month ? formatDiaryMonth(month) : "Jump to"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            {month ? "Pick a training week." : "Pick a month."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {month ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setMonth(null)}
              >
                <ChevronLeftIcon aria-hidden />
                {month.slice(0, 4)}
              </Button>
              <ul className="flex flex-col gap-2">
                {trainingWeeksOfMonth(month, currentWeek).map((week) => {
                  const range = diaryWindow(week, 1);
                  const movingTime = totals.weeks.get(week) ?? 0;
                  return (
                    <li key={week}>
                      <button
                        type="button"
                        className="bg-muted hover:bg-muted/70 flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-start"
                        onClick={() => onPickWeek(week)}
                      >
                        <span className="font-medium">
                          {formatDiaryRange(range.start, range.end)}
                        </span>
                        <span className="text-muted-foreground text-sm tabular-nums">
                          {movingTime > 0 ? formatHours(movingTime / 3600) : "Rest"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous year"
                  disabled={year <= oldestYear}
                  onClick={() => setYear(year - 1)}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                <span aria-live="polite" className="text-lg font-semibold tabular-nums">
                  {year}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next year"
                  disabled={year >= currentYear}
                  onClick={() => setYear(year + 1)}
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {MONTHS.map((name, index) => {
                  const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                  const outside = key < oldestMonth || key > currentMonth;
                  const total = totals.months.get(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={outside}
                      aria-current={key === cursorMonth ? "date" : undefined}
                      className="bg-muted hover:bg-muted/70 aria-[current=date]:border-primary flex min-h-16 flex-col items-start justify-center rounded-lg border-2 border-transparent px-3 py-2 text-start disabled:pointer-events-none disabled:opacity-40"
                      onClick={() => (pickWeek ? setMonth(key) : onPickMonth(key))}
                    >
                      <span className="font-semibold">{name}</span>
                      {outside ? null : (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {total ? (
                            <>
                              {total.count} {total.count === 1 ? "activity" : "activities"}
                              <br />
                              {formatHours(total.movingTime / 3600)}
                            </>
                          ) : (
                            "Rest"
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
