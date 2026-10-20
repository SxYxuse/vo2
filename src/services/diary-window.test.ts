import { describe, expect, it } from "vite-plus/test";

import {
  diaryWindow,
  formatDiaryMonth,
  formatDiaryRange,
  lastWeekOfMonth,
  monthKey,
  monthOfWeek,
  parseDiaryMonthSearch,
  parseDiaryWeekSearch,
  resolveDiaryCursorMonth,
  stepDiaryMonth,
  stepDiaryWeek,
} from "./diary-window.ts";

describe("monthKey", () => {
  it("uses the athlete's timezone, not UTC", () => {
    const lateOnTheLast = new Date("2026-09-30T23:30:00Z");
    expect(monthKey(lateOnTheLast, "UTC")).toBe("2026-09");
    expect(monthKey(lateOnTheLast, "Europe/Brussels")).toBe("2026-10");
  });
});

describe("stepDiaryMonth", () => {
  it("moves one month across year boundaries", () => {
    expect(stepDiaryMonth("2026-01", -1, "2026-10")).toBe("2025-12");
    expect(stepDiaryMonth("2025-12", 1, "2026-10")).toBe("2026-01");
  });

  it("never moves past the current month", () => {
    expect(stepDiaryMonth("2026-10", 1, "2026-10")).toBe("2026-10");
  });
});

describe("parseDiaryMonthSearch", () => {
  it("accepts YYYY-MM only", () => {
    expect(parseDiaryMonthSearch("2026-09")).toBe("2026-09");
    expect(parseDiaryMonthSearch("2026-13")).toBeUndefined();
    expect(parseDiaryMonthSearch("2026-09-01")).toBeUndefined();
    expect(parseDiaryMonthSearch(202609)).toBeUndefined();
  });
});

describe("resolveDiaryCursorMonth", () => {
  it("falls back to the current month for a missing or future month", () => {
    expect(resolveDiaryCursorMonth(undefined, "2026-10")).toBe("2026-10");
    expect(resolveDiaryCursorMonth("2026-12", "2026-10")).toBe("2026-10");
    expect(resolveDiaryCursorMonth("2026-08", "2026-10")).toBe("2026-08");
  });
});

describe("formatDiaryMonth", () => {
  it("names the month and year", () => {
    expect(formatDiaryMonth("2026-10")).toBe("October 2026");
  });
});

describe("diaryWindow", () => {
  it("ends on the cursor week's Sunday and reaches back whole weeks", () => {
    expect(diaryWindow("2026-10-19", 4)).toEqual({
      start: "2026-09-28",
      end: "2026-10-25",
      days: 28,
    });
    expect(diaryWindow("2026-10-19", 1)).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
      days: 7,
    });
  });
});

describe("stepDiaryWeek", () => {
  it("moves by the shown number of weeks", () => {
    expect(stepDiaryWeek("2026-10-19", -1, "2026-10-19", 4)).toBe("2026-09-21");
    expect(stepDiaryWeek("2026-10-19", -1, "2026-10-19")).toBe("2026-10-12");
  });

  it("never moves past the current week", () => {
    expect(stepDiaryWeek("2026-10-05", 1, "2026-10-19", 4)).toBe("2026-10-19");
  });
});

describe("parseDiaryWeekSearch", () => {
  it("accepts Mondays only", () => {
    expect(parseDiaryWeekSearch("2026-10-19")).toBe("2026-10-19");
    expect(parseDiaryWeekSearch("2026-10-20")).toBeUndefined();
    expect(parseDiaryWeekSearch("2026-02-30")).toBeUndefined();
  });
});

describe("switching between a month and weeks", () => {
  it("keeps the place in time", () => {
    expect(lastWeekOfMonth("2026-08")).toBe("2026-08-31");
    expect(lastWeekOfMonth("2026-09")).toBe("2026-09-28");
    expect(monthOfWeek("2026-09-28")).toBe("2026-10");
  });
});

describe("formatDiaryRange", () => {
  it("drops repeated months and years", () => {
    expect(formatDiaryRange("2026-09-28", "2026-10-25")).toBe("Sep 28 – Oct 25, 2026");
    expect(formatDiaryRange("2026-10-19", "2026-10-25")).toBe("Oct 19 – 25, 2026");
    expect(formatDiaryRange("2025-12-29", "2026-01-04")).toBe("Dec 29, 2025 – Jan 4, 2026");
  });
});
