import { describe, expect, test } from "vite-plus/test";

import {
  NO_HISTORY_REST_WEEKDAYS,
  goalEffect,
  historyStats,
  suggestedShape,
  type BuilderActivity,
} from "./plan-builder.types.ts";
import type { Goal } from "./season.types.ts";
import { addDayKey } from "./training-plan.types.ts";

/** A Monday. */
const WEEK = "2026-10-26";

/** Twelve weeks: rides Tuesday and Thursday, a long ride Saturday, a run and a ride Sunday. */
function habits(): BuilderActivity[] {
  const rows: BuilderActivity[] = [];
  for (let week = 1; week <= 12; week += 1) {
    const monday = addDayKey(WEEK, -7 * week);
    const at = (offset: number, minutes: number, sportType = "Ride") =>
      rows.push({
        startDate: new Date(`${addDayKey(monday, offset)}T08:00:00Z`),
        movingTime: minutes * 60,
        sportType,
        distance: minutes * 400,
      });
    at(1, 60);
    at(3, 75);
    at(5, 200);
    at(6, 50, "Run");
    at(6, 60);
  }
  return rows;
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g",
    name: "Gravel des Monts",
    sportType: "Ride",
    date: "2026-12-13",
    distanceM: 90_000,
    elevationGainM: 1500,
    objective: "perform",
    priority: "B",
    ...overrides,
  };
}

describe("historyStats", () => {
  test("reads a short history from its first week, not padded with empty weeks", () => {
    const recent = habits().filter((row) => row.startDate >= new Date("2026-09-14T00:00:00Z"));
    const stats = historyStats(recent, WEEK, "UTC");
    expect(stats.weeklyMinutes.low).toBe(445);
    expect(stats.weeklyMinutes.average).toBe(445);
  });

  test("reads the athlete's usual week", () => {
    const stats = historyStats(habits(), WEEK, "UTC");
    expect(stats.weeks).toBe(12);
    expect(stats.weeklyMinutes.average).toBe(445);
    expect(stats.sessionsPerWeek).toBe(5);
    expect(stats.doubleDaysPerWeek).toBe(1);
    expect(stats.usualLongWeekday).toBe(6);
    expect(stats.longest).toMatchObject({ minutes: 200, sport: "cycling" });
    expect(stats.sportShare.cycling).toBeGreaterThan(0.8);
  });
});

describe("suggestedShape", () => {
  test("rests on the days the athlete rarely trains and keeps their long day and doubles", () => {
    const shape = suggestedShape(historyStats(habits(), WEEK, "UTC"), []);
    expect(shape.restWeekdays).toEqual([1, 3, 5]);
    expect(shape.longWeekday).toBe(6);
    expect(shape.doubleDays).toBe(1);
    expect(shape.sports).toEqual(["cycling", "running"]);
  });

  test("starts from four training days without history", () => {
    const shape = suggestedShape(historyStats([], WEEK, "UTC"), []);
    expect(shape.restWeekdays).toEqual(NO_HISTORY_REST_WEEKDAYS);
    expect(shape.longWeekday).toBe(6);
    expect(shape.doubleDays).toBe(0);
  });

  test("plans a goal's sport even when the athlete rarely does it", () => {
    const shape = suggestedShape(historyStats(habits(), WEEK, "UTC"), [
      goal({ sportType: "Swim" }),
    ]);
    expect(shape.sports).toContain("swimming");
  });
});

describe("goalEffect", () => {
  test("says how each goal shapes the plan by priority and objective", () => {
    expect(goalEffect(goal({ priority: "A", objective: "finishWell" }), true)).toBe(
      "Base, build, peak, and taper toward it, with 2 key sessions a week to finish well.",
    );
    expect(goalEffect(goal(), false)).toBe(
      "A tune-up; 3 lighter days before, an opener the day before, 2 easy days after, in a week at 85 %.",
    );
    expect(goalEffect(goal({ priority: "C", objective: "finish" }), false)).toBe(
      "Trained through: it counts as a hard session.",
    );
  });
});
