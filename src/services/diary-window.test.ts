import { describe, expect, it } from "vite-plus/test";

import {
  formatDiaryMonth,
  monthKey,
  parseDiaryMonthSearch,
  resolveDiaryCursorMonth,
  stepDiaryMonth,
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
