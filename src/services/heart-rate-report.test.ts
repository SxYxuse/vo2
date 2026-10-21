import { describe, expect, test } from "vite-plus/test";

import { buildHeartRateReport, intensitySplit, reportBucketSize } from "./heart-rate-report.ts";

const NOW = new Date("2026-10-21T12:00:00Z");

describe("buildHeartRateReport", () => {
  test("buckets sessions by week, keeping empty weeks", () => {
    const report = buildHeartRateReport(
      [
        { start: "2026-09-29T08:00:00Z", zoneSeconds: [600, 2400, 0, 0, 0], avgBpm: 130 },
        { start: "2026-10-01T08:00:00Z", zoneSeconds: [0, 0, 600, 600, 600], avgBpm: 165 },
        { start: "2026-10-20T08:00:00Z", zoneSeconds: [0, 1800, 0, 0, 0], avgBpm: 140 },
      ],
      {
        size: "week",
        timeZone: "UTC",
        startMs: new Date("2026-09-21T00:00:00Z").getTime(),
        now: NOW,
      },
    );
    expect(report.buckets.map((bucket) => bucket.key)).toEqual([
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    // Weighted by time: (130 × 3000 + 165 × 1800) / 4800.
    expect(report.buckets[1]).toMatchObject({ sessions: 2, seconds: 4800, avgBpm: 143.1 });
    expect(report.buckets[2]).toMatchObject({ sessions: 0, seconds: 0, avgBpm: null });
    expect(report.sessions).toBe(3);
    expect(report.seconds).toBe(6600);
    // 30.5 days of period.
    expect(report.weeklySeconds).toBe(Math.round(6600 / (30.5 / 7)));
    expect(report.avgBpm).toBe(142.3);
    expect(report.intensity?.low).toBeCloseTo(4800 / 6600);
  });

  test("starts all-time months at the first session and crosses the year", () => {
    const report = buildHeartRateReport(
      [{ start: "2025-11-15T08:00:00Z", zoneSeconds: [3600, 0, 0, 0, 0], avgBpm: 120 }],
      { size: "month", timeZone: "UTC", startMs: null, now: NOW },
    );
    expect(report.buckets[0].key).toBe("2025-11");
    expect(report.buckets.at(-1)?.key).toBe("2026-10");
    expect(report.buckets).toHaveLength(12);
  });

  test("is empty without heart-rate time", () => {
    const report = buildHeartRateReport([], {
      size: "day",
      timeZone: "UTC",
      startMs: null,
      now: NOW,
    });
    expect(report.buckets).toEqual([]);
    expect(report.intensity).toBeNull();
  });
});

test("reportBucketSize keeps the bar count readable", () => {
  expect(reportBucketSize("7d")).toBe("day");
  expect(reportBucketSize("3m")).toBe("week");
  expect(reportBucketSize("all")).toBe("month");
});

test("intensitySplit reads zones 1–2 as easy and 4–5 as hard", () => {
  expect(intensitySplit([1, 1, 1, 0.5, 0.5])).toEqual({ low: 0.5, moderate: 0.25, high: 0.25 });
  expect(intensitySplit([0, 0, 0, 0, 0])).toBeNull();
});
