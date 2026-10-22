import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  averageWeeklyMovingSeconds,
  buildPmc,
  slicePmc,
  type FitnessLoad,
} from "./training-load.ts";
import { recentAverageWeeklyHours } from "./training-plan.types.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-04-15T12:00:00Z");

function dailyLoads(days: number, everyDays = 1): FitnessLoad[] {
  return Array.from({ length: Math.ceil(days / everyDays) }, (_, index) => ({
    start: new Date(NOW.getTime() - (days - index * everyDays) * DAY).toISOString(),
    load: 50,
    estimatedLoad: 50,
    movingTime: 3600 + index * 60,
  }));
}

/** The 3-month average read off the full fitness series, the way it was computed before. */
function averageFromSeries(loads: FitnessLoad[], timeZone: string) {
  const series = slicePmc(buildPmc(loads, timeZone), "3m", timeZone);
  return averageWeeklyMovingSeconds(loads, series, timeZone) / 3600;
}

describe("recentAverageWeeklyHours", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    ["two weeks of history", dailyLoads(14), "UTC"],
    ["years of history", dailyLoads(4 * 365, 2), "UTC"],
    ["history across DST changes", dailyLoads(400), "Europe/Paris"],
    ["a history ending months ago", dailyLoads(500).slice(0, 300), "America/New_York"],
  ])("matches the full fitness series for %s", (_label, loads, timeZone) => {
    expect(recentAverageWeeklyHours(loads, timeZone, NOW)).toBeCloseTo(
      averageFromSeries(loads, timeZone),
      10,
    );
  });

  test("is zero without activities", () => {
    expect(recentAverageWeeklyHours([], "UTC", NOW)).toBe(0);
  });
});
