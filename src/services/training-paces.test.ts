import { describe, expect, it } from "vite-plus/test";

import {
  activePacesFrom,
  estimateVdot,
  predictRaceSeconds,
  predictedTimeTrend,
  trendChange,
  type RunEffort,
} from "./training-paces.types.ts";

let ids = 0;
/** A run holding one best effort; a 40-minute 10 km is VDOT 51.9 (Daniels). */
function run(start: string, metres = 10_000, seconds = 2400): RunEffort {
  ids += 1;
  return { activityId: `run-${ids}`, name: `Run ${ids}`, start, metres, seconds };
}

describe("predictedTimeTrend", () => {
  it("leaves out runs after the as-of date", () => {
    const efforts = [
      run("2026-01-03T09:00:00Z"),
      run("2026-01-04T09:00:00Z"),
      run("2026-01-08T09:00:00Z", 10_000, 2100),
      run("2026-01-09T09:00:00Z", 10_000, 2100),
    ];
    const [point] = predictedTimeTrend(efforts, [new Date("2026-01-04T12:00:00Z")], 10_000);
    expect(point?.vdot).toBe(51.9);
    expect(point?.seconds).toBeCloseTo(2400, -1);
  });

  it("drops runs older than 16 weeks before the as-of date", () => {
    const efforts = [
      run("2025-09-01T09:00:00Z", 10_000, 1800),
      run("2025-09-02T09:00:00Z", 10_000, 1800),
      run("2026-01-03T09:00:00Z"),
      run("2026-01-04T09:00:00Z"),
    ];
    const [point] = predictedTimeTrend(efforts, [new Date("2026-01-04T12:00:00Z")], 10_000);
    expect(point?.vdot).toBe(51.9);
  });

  it("leaves a week empty with fewer than two qualifying runs", () => {
    const efforts = [run("2026-01-03T09:00:00Z"), run("2026-01-04T09:00:00Z", 1000, 200)];
    const [point] = predictedTimeTrend(efforts, [new Date("2026-01-04T12:00:00Z")], 10_000);
    expect(point).toEqual({ at: new Date("2026-01-04T12:00:00Z"), vdot: null, seconds: null });
  });

  it("ends on today's Automatic estimate and its predicted time", () => {
    const now = new Date("2026-03-01T12:00:00Z");
    const efforts = [
      run("2026-01-10T09:00:00Z", 5000, 1140),
      run("2026-02-01T09:00:00Z"),
      run("2026-02-20T09:00:00Z", 21_097.5, 5400),
    ];
    const today = estimateVdot(efforts, now, 21_097.5);
    const points = predictedTimeTrend(efforts, [new Date("2026-02-22T12:00:00Z"), now], 21_097.5);
    expect(today).not.toBeNull();
    expect(points.at(-1)).toEqual({
      at: now,
      vdot: today!.vdot,
      seconds: predictRaceSeconds(today!.vdot, 21_097.5),
    });
  });

  it("fades 1 % of VDOT a week without a new best", () => {
    const efforts = [run("2026-01-03T12:00:00Z"), run("2026-01-03T12:00:00Z")];
    const tenWeeksOn = new Date("2026-03-14T12:00:00Z");
    const [point] = predictedTimeTrend(efforts, [tenWeeksOn], 10_000);
    expect(point?.vdot).toBe(46.7);
  });

  it("follows the stronger run, using the target distance only for near ties", () => {
    const at = new Date("2026-01-04T12:00:00Z");
    const twoDistances = (start: string, fiveKSeconds: number): RunEffort[] => {
      const tenK = run(start);
      return [tenK, { ...tenK, metres: 5000, seconds: fiveKSeconds }];
    };
    const stronger5k = [
      ...twoDistances(at.toISOString(), 1080),
      ...twoDistances(at.toISOString(), 1080),
    ];
    expect(predictedTimeTrend(stronger5k, [at], 10_000)[0]?.vdot).toBe(56.3);
  });

  it("breaks a near tie toward the target distance", () => {
    const at = new Date("2026-01-04T12:00:00Z");
    const nearTie = [run(at.toISOString(), 10_000, 2400.2), run(at.toISOString(), 5000, 1156.9)];
    expect(predictedTimeTrend(nearTie, [at], 10_000)[0]?.vdot).toBe(51.9);
    expect(predictedTimeTrend(nearTie, [at], 5000)[0]?.vdot).toBe(52);
  });
});

describe("trendChange", () => {
  const week = (date: string, vdot: number | null, seconds: number | null) => ({
    date,
    vdot,
    seconds,
  });

  it("compares the first and last weeks with an estimate, skipping gaps at either end", () => {
    const change = trendChange([
      week("2026-01-04", null, null),
      week("2026-01-11", 46.1, 2652),
      week("2026-01-18", null, null),
      week("2026-04-05", 47.4, 2581),
      week("2026-04-08", null, null),
    ]);
    expect(change).toEqual({
      first: { date: "2026-01-11", vdot: 46.1, seconds: 2652 },
      last: { date: "2026-04-05", vdot: 47.4, seconds: 2581 },
      weeks: 12,
    });
  });

  it("has no first week when only one week has an estimate", () => {
    const change = trendChange([week("2026-01-04", null, null), week("2026-01-11", 46.1, 2652)]);
    expect(change).toEqual({ first: null, last: week("2026-01-11", 46.1, 2652), weeks: 0 });
  });

  it("is null without any estimate", () => {
    expect(trendChange([week("2026-01-04", null, null)])).toBeNull();
  });
});

describe("activePacesFrom", () => {
  const now = new Date("2026-04-08T12:00:00Z");
  const race = { metres: 10_000, seconds: 2400, date: "2026-03-01" } as const;
  const effort = run("2026-03-02T09:00:00Z");

  it("is a picked best effort when the athlete picked one", () => {
    expect(activePacesFrom({ from: "effort", effort, easyFrom: "heartRate" }, null, now)).toBe(
      "effort",
    );
  });

  it("is the race result while it counts, also for athletes from before the choice", () => {
    expect(activePacesFrom({ effort: null, easyFrom: "heartRate" }, race, now)).toBe("race");
  });

  it("goes back to Automatic once the race result is older than 16 weeks", () => {
    const old = { ...race, date: "2025-11-01" };
    expect(activePacesFrom({ from: "race", effort: null, easyFrom: "heartRate" }, old, now)).toBe(
      "automatic",
    );
  });
});
