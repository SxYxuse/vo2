import { describe, expect, test } from "vite-plus/test";

import {
  anchorEvent,
  eventPriority,
  eventTitle,
  formatDaysLeft,
  goalInputSchema,
  goalSportTypes,
  legLabel,
  newGoals,
  seasonCopy,
  seasonCopySchema,
  seasonEvents,
  type Goal,
  type PastGoal,
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
    priority: "A",
    ...overrides,
  };
}

describe("seasonEvents", () => {
  test("goals on the same date are one event, in date order", () => {
    const events = seasonEvents([
      goal("later", "2027-08-01"),
      goal("swim", "2027-06-01", { sportType: "Swim" }),
      goal("run", "2027-06-01"),
    ]);
    expect(events.map((event) => event.goals.map((g) => g.id))).toEqual([
      ["swim", "run"],
      ["later"],
    ]);
  });

  test("an event is as important as its most important goal", () => {
    const [event] = seasonEvents([
      goal("swim", "2027-06-01", { priority: "C" }),
      goal("run", "2027-06-01", { priority: "B" }),
    ]);
    expect(eventPriority(event!)).toBe("B");
  });

  test("legs share the event's name", () => {
    const [event] = seasonEvents([
      goal("b", "2027-06-01", { name: "Ironman WA · Bike", sportType: "Ride" }),
      goal("a", "2027-06-01", { name: "Ironman WA · Swim", sportType: "Swim" }),
    ]);
    expect(eventTitle(event!)).toBe("Ironman WA");
    expect(legLabel(event!.goals[0]!, event!)).toBe("Swim");
    const [single] = seasonEvents([goal("Marathon", "2027-06-01")]);
    expect(legLabel(single!.goals[0]!, single!)).toBeNull();
  });
});

describe("anchorEvent", () => {
  test("the next A event leads, even after a B one", () => {
    const events = seasonEvents([
      goal("half", "2027-04-01", { priority: "B" }),
      goal("marathon", "2027-05-10"),
    ]);
    expect(anchorEvent(events)?.date).toBe("2027-05-10");
  });

  test("without an A event the next B one leads; C events never do", () => {
    const events = seasonEvents([
      goal("club race", "2027-04-01", { priority: "C" }),
      goal("half", "2027-05-01", { priority: "B" }),
    ]);
    expect(anchorEvent(events)?.date).toBe("2027-05-01");
    expect(anchorEvent(seasonEvents([goal("c", "2027-04-01", { priority: "C" })]))).toBeNull();
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
  expect(goalSportTypes({})).toContain("OpenWaterSwim");
});

test("a goal can only be on a ride, run, swim, or walk sport type (ADR 0029)", () => {
  expect(goalSportTypes({ Rowing: { visible: true } })).not.toContain("Rowing");
  const rowing = { name: "Head of the River", sportType: "Rowing", date: "2027-03-20" };
  const input = { distanceM: null, elevationGainM: null, objective: "finish", ...rowing };
  expect(goalInputSchema.safeParse(input).success).toBe(false);
  expect(goalInputSchema.safeParse({ ...input, sportType: "TrailRun" }).success).toBe(true);
});

describe("season copy", () => {
  test("a copied season parses back into the same goals, without their ids", () => {
    const { id: _id, ...marathon } = goal("Marathon", "2027-04-10", {
      distanceM: 42_195,
      priority: "B",
    });
    const past: PastGoal = { id: "past", ...marathon, activityId: "123" };
    const copied = seasonCopy([past]);
    expect(seasonCopySchema.parse(JSON.parse(JSON.stringify(copied))).goals).toEqual([marathon]);
  });

  test("pasting skips goals the season already has, and repeats within the paste", () => {
    const existing = [goal("Marathon", "2027-04-10")];
    const pasted = [
      goal(" marathon ", "2027-04-10"),
      goal("Marathon", "2027-04-10", { sportType: "Ride" }),
      goal("10K", "2027-03-01"),
      goal("10K", "2027-03-01"),
    ];
    expect(newGoals(pasted, existing).map((g) => [g.name, g.sportType])).toEqual([
      ["Marathon", "Ride"],
      ["10K", "Run"],
    ]);
  });
});
