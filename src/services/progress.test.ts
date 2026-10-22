import { describe, expect, test } from "vite-plus/test";

import type { EfficiencyPoint } from "./heart-insights.ts";
import {
  bestChangePct,
  compareEfficiency,
  comparePowerBests,
  compareRunBests,
  efficiencyVerdict,
} from "./progress.ts";

const NOW = new Date("2026-10-22T12:00:00Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function point(days: number, ef: number, avgHeartrate = 140, aerobic = true): EfficiencyPoint {
  return { start: daysAgo(days), ef, output: ef * avgHeartrate, avgHeartrate, aerobic };
}

describe("efficiency comparison", () => {
  test("compares output at one heart rate across the two six-week blocks", () => {
    const points = [
      ...[50, 60, 70].map((days) => point(days, 1.4)),
      ...[5, 15, 25].map((days) => point(days, 1.5)),
    ];
    const comparison = compareEfficiency(points, NOW)!;
    expect(comparison.referenceBpm).toBe(140);
    expect(comparison.now).toEqual({ output: 210, count: 3 });
    expect(comparison.before).toEqual({ output: 196, count: 3 });
    expect(comparison.changePct).toBe(7.1);
    expect(efficiencyVerdict(comparison)?.tone).toBe("positive");
  });

  test("hard sessions and sessions older than twelve weeks are left out", () => {
    const points = [
      ...[5, 15, 25].map((days) => point(days, 1.5)),
      point(10, 3, 170, false),
      point(100, 1, 140),
    ];
    const comparison = compareEfficiency(points, NOW)!;
    expect(comparison.now?.count).toBe(3);
    expect(comparison.before).toBeNull();
    expect(comparison.changePct).toBeNull();
  });

  test("too few recent sessions gives no comparison", () => {
    expect(compareEfficiency([point(5, 1.5), point(50, 1.4)], NOW)).toBeNull();
  });
});

describe("best comparison", () => {
  test("keeps the highest power per block and the best of the year with its date", () => {
    const rows = comparePowerBests(
      [
        { start: daysAgo(200), bests: [{ seconds: 300, watts: 320 }] },
        { start: daysAgo(60), bests: [{ seconds: 300, watts: 280 }] },
        { start: daysAgo(10), bests: [{ seconds: 300, watts: 300 }] },
        { start: daysAgo(5), bests: [{ seconds: 300, watts: 290 }] },
      ],
      [60, 300],
      NOW,
    );
    expect(rows).toEqual([{ key: 300, now: 300, before: 280, year: 320, yearStart: daysAgo(200) }]);
    expect(bestChangePct(rows[0], "cycling")).toBe(7.1);
  });

  test("a faster run is the lower time and a positive change", () => {
    const [row] = compareRunBests(
      [
        { start: daysAgo(60), bests: [{ metres: 5000, seconds: 1500 }] },
        { start: daysAgo(10), bests: [{ metres: 5000, seconds: 1440 }] },
      ],
      [5000],
      NOW,
    );
    expect(row.now).toBe(1440);
    expect(row.year).toBe(1440);
    expect(bestChangePct(row, "running")).toBe(4.2);
  });
});
