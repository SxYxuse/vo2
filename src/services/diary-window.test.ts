import { describe, expect, it } from "vite-plus/test";

import { diaryWindow, stepDiaryWeek } from "./diary-window.ts";

describe("diaryWindow", () => {
  it("shows the cursor training week and the three before it for 4 weeks", () => {
    expect(diaryWindow("2026-10-12", "four-weeks")).toEqual({
      start: "2026-09-21",
      end: "2026-10-18",
      days: 28,
    });
  });

  it("keeps 4 weeks full at the start of a month", () => {
    expect(diaryWindow("2026-09-28", "four-weeks")).toMatchObject({
      start: "2026-09-07",
      end: "2026-10-04",
    });
  });

  it("shows only the cursor training week for week", () => {
    expect(diaryWindow("2026-10-12", "week")).toEqual({
      start: "2026-10-12",
      end: "2026-10-18",
      days: 7,
    });
  });
});

describe("stepDiaryWeek", () => {
  it("moves one training week back", () => {
    expect(stepDiaryWeek("2026-10-12", -1, "2026-10-12")).toBe("2026-10-05");
  });

  it("moves forward toward the current training week", () => {
    expect(stepDiaryWeek("2026-09-28", 1, "2026-10-12")).toBe("2026-10-05");
  });

  it("never walks past the current training week", () => {
    expect(stepDiaryWeek("2026-10-12", 1, "2026-10-12")).toBe("2026-10-12");
  });
});
