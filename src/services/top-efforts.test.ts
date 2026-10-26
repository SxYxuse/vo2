import { describe, expect, test } from "vite-plus/test";

import type { BestsActivity, Board } from "./personal-bests.ts";
import { findTopEfforts } from "./top-efforts.ts";

const NOW = new Date("2026-10-22T12:00:00Z");

type Seed = { id: string; start: string; value: number };

function boardWith(seeds: Seed[], kind: Board["kind"] = "time", key = 5000) {
  const activities: BestsActivity[] = seeds.map((seed) => ({
    id: seed.id,
    name: `Run ${seed.id}`,
    start: seed.start,
    sportType: "Run",
  }));
  const board: Board = {
    id: `running-${kind}-${key}`,
    sport: "running",
    kind,
    key,
    efforts: seeds.map((seed, index) => ({ activity: index, value: seed.value })),
  };
  return { activities, board };
}

/** `count` earlier runs in 2024, all slower than 1200 s. */
function oldRuns(count: number, from = 1300): Seed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `old-${index}`,
    start: `2024-0${(index % 9) + 1}-10T08:00:00Z`,
    value: from + index * 10,
  }));
}

describe("top efforts", () => {
  test("a new fastest time is the personal best", () => {
    const { activities, board } = boardWith([
      ...oldRuns(12),
      { id: "new", start: "2026-10-20T07:00:00Z", value: 1200 },
    ]);
    const [placement] = findTopEfforts([board], activities, new Set(["new"]), NOW);
    expect(placement).toMatchObject({
      boardId: "running-time-5000",
      allTimeRank: 1,
      value: 1200,
      bestBefore: 1300,
    });
    expect(placement?.activity.id).toBe("new");
  });

  test("an effort outside the all-time top 10 with too few runs this year is not celebrated", () => {
    const { activities, board } = boardWith([
      ...oldRuns(12),
      { id: "new", start: "2026-10-20T07:00:00Z", value: 2000 },
    ]);
    expect(findTopEfforts([board], activities, new Set(["new"]), NOW)).toEqual([]);
  });

  test("a year rank counts once the year already has ten efforts before it", () => {
    const thisYear = Array.from({ length: 10 }, (_, index) => ({
      id: `y-${index}`,
      start: `2026-0${(index % 9) + 1}-15T08:00:00Z`,
      value: 1900 + index * 10,
    }));
    const { activities, board } = boardWith([
      ...oldRuns(12),
      ...thisYear,
      { id: "new", start: "2026-10-20T07:00:00Z", value: 1850 },
    ]);
    const [placement] = findTopEfforts([board], activities, new Set(["new"]), NOW);
    expect(placement).toMatchObject({ allTimeRank: null, yearRank: 1, year: 2026 });
  });

  test("with fewer than ten earlier efforts this year, only the all-time rank counts", () => {
    const { activities, board } = boardWith([
      ...oldRuns(5),
      { id: "jan", start: "2026-01-03T08:00:00Z", value: 1400 },
      { id: "new", start: "2026-10-20T07:00:00Z", value: 1250 },
    ]);
    const [placement] = findTopEfforts([board], activities, new Set(["new"]), NOW);
    expect(placement).toMatchObject({ allTimeRank: 1, yearRank: null });
  });

  test("bigger is better on power and biggest-day boards", () => {
    const { activities, board } = boardWith(
      [
        { id: "a", start: "2025-05-01T08:00:00Z", value: 250 },
        { id: "new", start: "2026-10-20T07:00:00Z", value: 280 },
      ],
      "power",
      1200,
    );
    const [placement] = findTopEfforts([board], activities, new Set(["new"]), NOW);
    expect(placement).toMatchObject({ allTimeRank: 1, bestBefore: 250 });
  });

  test("only the given activities are celebrated", () => {
    const { activities, board } = boardWith([
      { id: "a", start: "2026-10-18T08:00:00Z", value: 1300 },
      { id: "b", start: "2026-10-20T08:00:00Z", value: 1250 },
    ]);
    const placements = findTopEfforts([board], activities, new Set(["a"]), NOW);
    expect(placements.map((placement) => [placement.activity.id, placement.allTimeRank])).toEqual([
      ["a", 2],
    ]);
    // The later, faster run is not a best before "a".
    expect(placements[0]?.bestBefore).toBeNull();
  });

  test("the best placement comes first: all-time rank, then year rank", () => {
    const fiveK = boardWith([
      ...oldRuns(3, 1100),
      { id: "new", start: "2026-10-20T07:00:00Z", value: 1250 },
    ]);
    // The 10 km board indexes into the same activity list, plus one older 10 km run.
    const activities = fiveK.activities.concat({
      id: "x",
      name: "Run x",
      start: "2025-01-01T08:00:00Z",
      sportType: "Run",
    });
    const newIndex = fiveK.activities.findIndex((activity) => activity.id === "new");
    const tenBoard: Board = {
      id: "running-time-10000",
      sport: "running",
      kind: "time",
      key: 10000,
      efforts: [
        { activity: activities.length - 1, value: 2700 },
        { activity: newIndex, value: 2600 },
      ],
    };
    const placements = findTopEfforts([fiveK.board, tenBoard], activities, new Set(["new"]), NOW);
    expect(placements.map((placement) => [placement.boardId, placement.allTimeRank])).toEqual([
      ["running-time-10000", 1],
      ["running-time-5000", 4],
    ]);
  });
});
