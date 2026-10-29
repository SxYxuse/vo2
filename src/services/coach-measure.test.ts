import { describe, expect, test } from "vite-plus/test";

import { downsampleStreams, measureActivity } from "./coach-measure.ts";

/** One sample a second: 1,000 s at 3 m/s, then 1,000 s at 4 m/s (7 km in all). */
function negativeSplitRun() {
  const time: number[] = [];
  const distance: number[] = [];
  const heartrate: number[] = [];
  let metres = 0;
  for (let second = 0; second <= 2000; second += 1) {
    time.push(second);
    distance.push(metres);
    heartrate.push(second < 1000 ? 140 : 160);
    metres += second < 1000 ? 3 : 4;
  }
  return { time, distance, heartrate, altitude: null, watts: null };
}

describe("measure an activity", () => {
  test("times a distance range from the start", () => {
    const result = measureActivity(negativeSplitRun(), "Run", {
      kind: "range",
      unit: "metres",
      start: 0,
      end: 1500,
    });
    expect(result).toMatchObject({
      measures: [{ startM: 0, endM: 1500, seconds: 500, paceSecPerKm: 333, avgHeartrate: 140 }],
    });
  });

  test("finds the fastest stretch of a distance anywhere in the activity", () => {
    const result = measureActivity(negativeSplitRun(), "Run", {
      kind: "fastest",
      unit: "metres",
      length: 1500,
    });
    expect(result).toMatchObject({
      measures: [{ distanceM: 1500, seconds: 375, paceSecPerKm: 250, avgHeartrate: 160 }],
    });
    expect(result.measures[0].startM).toBeGreaterThanOrEqual(3000);
  });

  test("splits every kilometre", () => {
    const result = measureActivity(negativeSplitRun(), "Run", {
      kind: "splits",
      unit: "metres",
      length: 1000,
    });
    expect(result.measures.map((split) => split.seconds)).toEqual([
      333, 333, 333, 250, 250, 250, 250,
    ]);
  });

  test("finds the most distance covered in a duration", () => {
    const result = measureActivity(negativeSplitRun(), "Run", {
      kind: "fastest",
      unit: "seconds",
      length: 60,
    });
    expect(result).toMatchObject({ measures: [{ seconds: 60, distanceM: 240 }] });
  });

  test("a pause does not count toward the time", () => {
    const time = [0, 100, 200, 800, 900, 1000];
    const distance = [0, 300, 600, 601, 901, 1201];
    const result = measureActivity(
      { time, distance, heartrate: null, altitude: null, watts: null },
      "Run",
      { kind: "range", unit: "metres", start: 0, end: 1200 },
    );
    // Five 100 s legs; the 600 s stand at a crossing is left out.
    expect(result.measures[0].seconds).toBe(400);
  });

  test("a range past the end says how far the activity went", () => {
    const result = measureActivity(negativeSplitRun(), "Run", {
      kind: "range",
      unit: "metres",
      start: 0,
      end: 10000,
    });
    expect(result.measures[0].endM).toBe(7000);
    expect(result.note).toContain("7000 metres");
  });

  test("says why when the activity has no distance stream", () => {
    const result = measureActivity(
      { time: [0, 1, 2], distance: null, heartrate: null, altitude: null, watts: null },
      "Run",
      { kind: "range", unit: "metres", start: 0, end: 1000 },
    );
    expect(result).toEqual({ measures: [], note: expect.stringContaining("distance") });
  });
});

describe("downsample streams", () => {
  test("keeps at most the asked number of points, first and last included", () => {
    const run = negativeSplitRun();
    const result = downsampleStreams(run, ["heartrate"], 100);
    expect(result.points).toBe(100);
    expect(result.distanceKm).toHaveLength(100);
    expect(result.distanceKm[0]).toBe(0);
    expect(result.distanceKm.at(-1)).toBe(7);
    expect(result.series.heartrate?.at(0)).toBe(140);
    expect(result.series.heartrate?.at(-1)).toBe(160);
  });

  test("averages each bucket rather than picking one sample", () => {
    const heartrate = Array.from({ length: 1000 }, (_, index) => (index % 2 ? 150 : 130));
    const time = heartrate.map((_, index) => index);
    const result = downsampleStreams(
      { time, distance: time, heartrate, altitude: null, watts: null },
      ["heartrate"],
      10,
    );
    // A picked sample would read 130 or 150.
    for (const value of result.series.heartrate?.slice(1, -1) ?? []) {
      expect(Math.abs((value ?? 0) - 140)).toBeLessThan(1);
    }
  });

  test("leaves out a channel the activity did not record", () => {
    const result = downsampleStreams(negativeSplitRun(), ["heartrate", "watts"], 50);
    expect(result.series).not.toHaveProperty("watts");
    expect(result.missing).toEqual(["watts"]);
  });
});
