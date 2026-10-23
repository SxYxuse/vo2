import { describe, expect, test } from "vite-plus/test";

import {
  formatDaysLeft,
  goalSportTypes,
  mainFlagsAfterPick,
  normalizedMainFlags,
  seasonClusters,
  type Goal,
} from "./season.types.ts";

function goal(id: string, date: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    name: id,
    sportType: "Run",
    date,
    distanceM: 10_000,
    elevationGainM: null,
    objective: "finish",
    main: false,
    ...overrides,
  };
}

const dates = (goals: Goal[]) =>
  seasonClusters(goals).map((cluster) => cluster.events.map((event) => event.date));

describe("seasonClusters", () => {
  test("goals 4 weeks or more apart stand alone", () => {
    expect(dates([goal("a", "2027-04-01"), goal("b", "2027-04-29")])).toEqual([
      ["2027-04-01"],
      ["2027-04-29"],
    ]);
  });

  test("goals less than 4 weeks apart chain into one cluster", () => {
    const goals = [goal("c", "2027-05-20"), goal("a", "2027-04-01"), goal("b", "2027-04-28")];
    expect(dates(goals)).toEqual([["2027-04-01", "2027-04-28", "2027-05-20"]]);
  });

  test("goals on the same date are one event", () => {
    const [cluster] = seasonClusters([goal("swim", "2027-06-01"), goal("run", "2027-06-01")]);
    expect(cluster?.events).toHaveLength(1);
    expect(cluster?.events[0]?.goals.map((g) => g.id)).toEqual(["run", "swim"]);
  });

  test("the longest event is the main one until the athlete picks", () => {
    const goals = [
      goal("10k", "2027-04-01"),
      goal("marathon", "2027-04-20", { distanceM: 42_195 }),
    ];
    expect(seasonClusters(goals)[0]).toMatchObject({ mainDate: "2027-04-20", chosen: false });
  });

  test("elevation and sport count toward the longest", () => {
    const goals = [
      goal("ride", "2027-04-01", { sportType: "Ride", distanceM: 100_000 }),
      goal("trail", "2027-04-20", {
        sportType: "TrailRun",
        distanceM: 30_000,
        elevationGainM: 1_800,
      }),
    ];
    expect(seasonClusters(goals)[0]?.mainDate).toBe("2027-04-20");
  });

  test("a same-day multisport event adds its parts up", () => {
    const goals = [
      goal("swim", "2027-04-01", { sportType: "Swim", distanceM: 1_500 }),
      goal("ride", "2027-04-01", { sportType: "Ride", distanceM: 40_000 }),
      goal("run", "2027-04-01", { distanceM: 10_000 }),
      goal("ride-only", "2027-04-15", { sportType: "Ride", distanceM: 60_000 }),
    ];
    expect(seasonClusters(goals)[0]?.mainDate).toBe("2027-04-01");
  });

  test("the athlete's pick wins", () => {
    const goals = [
      goal("10k", "2027-04-01", { main: true }),
      goal("marathon", "2027-04-20", { distanceM: 42_195 }),
    ];
    expect(seasonClusters(goals)[0]).toMatchObject({ mainDate: "2027-04-01", chosen: true });
  });
});

describe("main flags", () => {
  test("picking an event flags all its goals and clears the rest of the cluster", () => {
    const goals = [
      goal("a", "2027-04-01", { main: true }),
      goal("b-swim", "2027-04-20"),
      goal("b-run", "2027-04-20"),
      goal("later", "2027-08-01"),
    ];
    expect(Object.fromEntries(mainFlagsAfterPick(goals, "b-run"))).toEqual({
      a: false,
      "b-swim": true,
      "b-run": true,
      later: false,
    });
  });

  test("a pick is dropped once its cluster breaks up", () => {
    const goals = [goal("a", "2027-04-01", { main: true }), goal("b", "2027-06-01")];
    expect(normalizedMainFlags(goals).get("a")).toBe(false);
  });

  test("only the first picked event survives when clusters merge", () => {
    const goals = [
      goal("a", "2027-04-01", { main: true }),
      goal("b", "2027-04-20", { main: true }),
    ];
    expect(Object.fromEntries(normalizedMainFlags(goals))).toEqual({ a: true, b: false });
  });
});

test("formatDaysLeft", () => {
  expect([0, 1, 47, -1, -3].map(formatDaysLeft)).toEqual([
    "Today",
    "Tomorrow",
    "In 47 days",
    "Yesterday",
    "3 days ago",
  ]);
});

test("goal sports are the ones shown in Settings, in picker order", () => {
  const shown = { Hike: { visible: true }, Run: { visible: true }, Ride: { visible: false } };
  expect(goalSportTypes(shown)).toEqual(["Run", "Hike"]);
  expect(goalSportTypes({}).length).toBeGreaterThan(40);
});
