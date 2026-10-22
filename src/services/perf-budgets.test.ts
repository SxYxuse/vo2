import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

/**
 * Work budgets for paths that walk an athlete's whole history. They count work rather than time
 * it, so they hold on any machine: building an Intl.DateTimeFormat per day or per activity once
 * froze the settings page for 3 s with ~1,000 activities. With PERF_METRICS_DIR set, CI also
 * writes the counts for the PR perf report.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-04-15T12:00:00Z");
const TIME_ZONE = "Europe/Brussels";

/** About four years of training, one activity every ~1.5 days. */
const ACTIVITY_COUNT = 1_000;
const starts = Array.from(
  { length: ACTIVITY_COUNT },
  (_, index) => new Date(NOW.getTime() - (4 * 365 - index * 1.46) * DAY),
);
const loads = starts.map((start) => ({
  start: start.toISOString(),
  load: 50,
  estimatedLoad: 0,
  movingTime: 3600,
}));
const sessions = starts.map((start) => ({
  start: start.toISOString(),
  zoneSeconds: [1200, 1200, 600, 300, 60],
  avgBpm: 140,
}));

/**
 * One for VO2's day keys and one that @date-fns/tz caches for zone offsets. A count that grows
 * with the history means a formatter is built per day or per activity.
 */
const FORMATTERS_PER_TIME_ZONE = 2;

type Metric = { label: string; unit: "count"; value: number; budget: number };
const metrics: Record<string, Metric> = {};

/** Date formatters built by the work `load` returns, imported fresh so no cache is warm. */
async function countFormatters(load: () => Promise<() => void>) {
  vi.resetModules();
  const work = await load();
  const spy = vi.spyOn(Intl, "DateTimeFormat");
  try {
    work();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

const budgets: Array<{
  key: string;
  label: string;
  budget: number;
  load: () => Promise<() => void>;
}> = [
  {
    key: "formatters.fitnessSeries",
    label: "Date formatters: fitness series, 4 years",
    budget: FORMATTERS_PER_TIME_ZONE,
    load: async () => {
      const { buildPmc } = await import("./training-load.ts");
      return () => buildPmc(loads, TIME_ZONE);
    },
  },
  {
    key: "formatters.recentWeeklyHours",
    label: "Date formatters: 3-month weekly hours",
    budget: FORMATTERS_PER_TIME_ZONE,
    load: async () => {
      const { recentAverageWeeklyHours } = await import("./training-plan.types.ts");
      return () => recentAverageWeeklyHours(loads, TIME_ZONE, NOW);
    },
  },
  {
    key: "formatters.weekKeys",
    label: "Date formatters: week of 1,000 activities",
    budget: FORMATTERS_PER_TIME_ZONE,
    load: async () => {
      const { weekStartKey } = await import("./training-plan.types.ts");
      return () => {
        for (const start of starts) weekStartKey(start, TIME_ZONE);
      };
    },
  },
  {
    key: "formatters.heartRateReport",
    label: "Date formatters: heart-rate report, all time",
    budget: FORMATTERS_PER_TIME_ZONE,
    load: async () => {
      const { buildHeartRateReport } = await import("./heart-rate-report.ts");
      return () => {
        for (const size of ["day", "week", "month"] as const) {
          buildHeartRateReport(sessions, { size, timeZone: TIME_ZONE, startMs: null, now: NOW });
        }
      };
    },
  },
];

describe("work budgets with four years of history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    const dir = process.env.PERF_METRICS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "work.json"), JSON.stringify({ metrics }, null, 2));
  });

  test.each(budgets)("$label stays within $budget", async ({ key, label, budget, load }) => {
    const value = await countFormatters(load);
    metrics[key] = { label, unit: "count", value, budget };
    expect(value).toBeLessThanOrEqual(budget);
  });
});
