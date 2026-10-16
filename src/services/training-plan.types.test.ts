import { describe, expect, it } from "vite-plus/test";

import {
  assignActivitiesToSessions,
  durationFitsPlan,
  formatHours,
  hasRecentWeeklyHours,
  hoursStillToFill,
  type MatchableActivity,
  type PlannedSession,
} from "./training-plan.types.ts";

function planned(overrides: Partial<PlannedSession>): PlannedSession {
  return {
    id: "session-1",
    date: "2026-10-13",
    weekStart: "2026-10-12",
    sportFamily: "running",
    title: "Easy run",
    targetMinutes: 60,
    targetLoad: 50,
    status: "planned",
    note: null,
    activityId: null,
    activityTitle: null,
    ...overrides,
  };
}

function completed(overrides: Partial<MatchableActivity>): MatchableActivity {
  return {
    id: "activity-1",
    date: "2026-10-13",
    family: "running",
    minutes: 60,
    load: 50,
    ...overrides,
  };
}

describe("assignActivitiesToSessions", () => {
  it("run Activity never matches a cycling planned session", () => {
    expect(
      assignActivitiesToSessions(
        [completed({ id: "run-1", family: "running", minutes: 60 })],
        [
          planned({
            id: "ride-session",
            sportFamily: "cycling",
            title: "Easy ride",
            targetMinutes: 60,
          }),
        ],
      ),
    ).toEqual([]);

    expect(
      assignActivitiesToSessions(
        [completed({ id: "ride-1", family: "cycling", minutes: 60 })],
        [
          planned({
            id: "run-session",
            sportFamily: "running",
            title: "Easy run",
            targetMinutes: 60,
          }),
        ],
      ),
    ).toEqual([]);
  });

  it("Activity outside the duration band does not match a planned session", () => {
    const session = planned({ id: "run-60", targetMinutes: 60 });

    expect(durationFitsPlan(32, 60)).toBe(false);
    expect(durationFitsPlan(33, 60)).toBe(true);
    expect(durationFitsPlan(96, 60)).toBe(true);
    expect(durationFitsPlan(97, 60)).toBe(false);

    expect(assignActivitiesToSessions([completed({ minutes: 32 })], [session])).toEqual([]);
    expect(assignActivitiesToSessions([completed({ minutes: 97 })], [session])).toEqual([]);
    expect(assignActivitiesToSessions([completed({ minutes: 60 })], [session])).toEqual([
      { sessionId: "run-60", activityId: "activity-1", date: "2026-10-13" },
    ]);
  });

  it("field test planned sessions are never assigned an Activity", () => {
    const matches = assignActivitiesToSessions(
      [
        completed({ id: "ride-1", family: "cycling", minutes: 75, load: 80 }),
        completed({ id: "run-beep", family: "running", minutes: 20, load: 30 }),
        completed({ id: "run-lthr", family: "running", minutes: 45, load: 55 }),
      ],
      [
        planned({
          id: "ftp",
          sportFamily: "cycling",
          title: "FTP 20-min",
          targetMinutes: 75,
        }),
        planned({
          id: "beep",
          sportFamily: "running",
          title: "Beep test",
          targetMinutes: 20,
        }),
        planned({
          id: "run-lthr",
          sportFamily: "running",
          title: "Run LTHR",
          targetMinutes: 45,
        }),
      ],
    );
    expect(matches).toEqual([]);
  });

  it("Activity already on a planned session is not assigned to another; quality is preferred over easy", () => {
    expect(
      assignActivitiesToSessions(
        [completed({ id: "taken-activity" })],
        [
          planned({ id: "already-matched", activityId: "taken-activity" }),
          planned({ id: "still-open", title: "Easy run" }),
        ],
      ),
    ).toEqual([]);

    const matches = assignActivitiesToSessions(
      [completed({ id: "shared-activity" })],
      [planned({ id: "easy", title: "Easy run" }), planned({ id: "quality", title: "Threshold" })],
    );
    expect(matches).toEqual([
      { sessionId: "quality", activityId: "shared-activity", date: "2026-10-13" },
    ]);
  });
});

describe("hoursStillToFill", () => {
  it("keeps remaining hours even when the week bucket is empty", () => {
    expect(hoursStillToFill(246, 300)).toBe(54);
    expect(formatHours(hoursStillToFill(246, 300) / 60)).toBe("54 min");
  });

  it("does not go below zero once the weekly hours target is met", () => {
    expect(hoursStillToFill(300, 300)).toBe(0);
    expect(hoursStillToFill(360, 300)).toBe(0);
  });
});

describe("hasRecentWeeklyHours", () => {
  it("is false until last-3-month average is a usable hours-intent baseline", () => {
    expect(hasRecentWeeklyHours(0)).toBe(false);
    expect(hasRecentWeeklyHours(0.2)).toBe(false);
    expect(hasRecentWeeklyHours(0.21)).toBe(true);
    expect(hasRecentWeeklyHours(6)).toBe(true);
  });
});
