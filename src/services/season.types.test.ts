import { describe, expect, test } from "vite-plus/test";

import {
  anchorEvent,
  eventPriority,
  eventTitle,
  formatDaysLeft,
  goalSportTypes,
  legLabel,
  seasonEvents,
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
  expect(goalSportTypes({}).length).toBeGreaterThan(40);
});
