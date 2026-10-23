import { describe, expect, test } from "vite-plus/test";

import {
  isNewBest,
  parseBestsSearch,
  powerCurve,
  previousBest,
  progression,
  topEfforts,
  type BestsActivity,
  type Board,
} from "./personal-bests.ts";

const NOW = new Date("2026-10-22T12:00:00Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

/** One activity per value, `days` apart going back from now. */
function boardOf(kind: Board["kind"], values: number[], spacingDays = 1) {
  const activities: BestsActivity[] = values.map((_, index) => ({
    id: String(index),
    name: `Activity ${index}`,
    start: daysAgo(index * spacingDays),
    sportType: "Run",
  }));
  const board: Board = {
    id: `running-${kind}-5000`,
    sport: "running",
    kind,
    key: 5000,
    efforts: values.map((value, index) => ({ activity: index, value })),
  };
  return { activities, board };
}

describe("top efforts", () => {
  test("ranks the fastest times first and keeps ten", () => {
    const values = [1300, 1250, 1400, 1241, 1500, 1350, 1260, 1270, 1280, 1290, 1600, 1700];
    const { activities, board } = boardOf("time", values);
    const top = topEfforts(board, activities, "all", NOW);
    expect(top).toHaveLength(10);
    expect(top.slice(0, 3).map((item) => item.value)).toEqual([1241, 1250, 1260]);
    expect(top[0].activity.id).toBe("3");
  });

  test("ranks the highest power first", () => {
    const { activities, board } = boardOf("power", [280, 310, 295]);
    expect(topEfforts(board, activities, "all", NOW).map((item) => item.value)).toEqual([
      310, 295, 280,
    ]);
  });

  test("the period keeps only efforts inside it", () => {
    // One effort every 20 days: 0, 20, 40, 60, … days ago.
    const { activities, board } = boardOf("time", [1300, 1290, 1280, 1200, 1210], 20);
    expect(topEfforts(board, activities, "6w", NOW).map((item) => item.value)).toEqual([
      1280, 1290, 1300,
    ]);
    expect(topEfforts(board, activities, "all", NOW)[0].value).toBe(1200);
  });

  test("a year keeps only that calendar year", () => {
    // 0, 100, and 200 days ago are in 2026; 300 days ago is in 2025.
    const { activities, board } = boardOf("time", [1300, 1290, 1280, 1200], 100);
    expect(topEfforts(board, activities, "2025", NOW).map((item) => item.value)).toEqual([1200]);
  });
});

describe("progression", () => {
  test("marks each new best in date order and finds the one before the personal best", () => {
    // Oldest first: 1300, 1320, 1280, 1290, 1260.
    const { activities, board } = boardOf("time", [1260, 1290, 1280, 1320, 1300]);
    const points = progression(board, activities, "all", NOW);
    expect(points.map((point) => [point.value, point.isBest, point.bestSoFar])).toEqual([
      [1300, true, 1300],
      [1320, false, 1300],
      [1280, true, 1280],
      [1290, false, 1280],
      [1260, true, 1260],
    ]);
    expect(previousBest(points)?.value).toBe(1280);
  });
});

describe("power curve", () => {
  test("puts the period's best at each duration next to the best of all time", () => {
    const activities: BestsActivity[] = [
      { id: "old", name: "Old", start: daysAgo(200), sportType: "Ride" },
      { id: "new", name: "New", start: daysAgo(5), sportType: "Ride" },
    ];
    const board = (key: number, old: number, recent: number): Board => ({
      id: `cycling-power-${key}`,
      sport: "cycling",
      kind: "power",
      key,
      efforts: [
        { activity: 0, value: old },
        { activity: 1, value: recent },
      ],
    });
    expect(powerCurve([board(300, 340, 320), board(60, 480, 500)], activities, "6w", NOW)).toEqual([
      { seconds: 60, period: 500, allTime: 500 },
      { seconds: 300, period: 320, allTime: 340 },
    ]);
  });
});

describe("new bests", () => {
  test("a best from the last 30 days is new", () => {
    expect(isNewBest(daysAgo(29), NOW)).toBe(true);
    expect(isNewBest(daysAgo(31), NOW)).toBe(false);
  });
});

describe("bests search", () => {
  test("keeps a valid tab, period, and board and drops anything else", () => {
    expect(
      parseBestsSearch({ sport: "cycling", period: 2025, best: "cycling-power-1200" }),
    ).toEqual({ sport: "cycling", period: "2025", best: "cycling-power-1200" });
    expect(parseBestsSearch({ sport: "walking", period: "3m", best: "<script>" })).toEqual({});
  });
});
