import { describe, expect, it } from "vite-plus/test";

import { diaryWindow, stepDiaryWeek } from "./diary-window.ts";

describe("diaryWindow", () => {
  it("shows the cursor training week and the three before it for four weeks", () => {
    expect(diaryWindow("2026-10-12", 4)).toEqual({
      start: "2026-09-21",
      end: "2026-10-18",
      days: 28,
    });
  });

  it("keeps four full weeks at the start of a month", () => {
    expect(diaryWindow("2026-09-28", 4)).toMatchObject({
      start: "2026-09-07",
      end: "2026-10-04",
    });
  });

  it("shows only the cursor training week for one week", () => {
    expect(diaryWindow("2026-10-12", 1)).toEqual({
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
