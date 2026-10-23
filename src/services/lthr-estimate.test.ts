import { describe, expect, test } from "vite-plus/test";

import { estimateLthr, thresholdEffort } from "./lthr-estimate.ts";

/** One sample a second: `minutes` at each heart rate, in order. */
function stream(...blocks: [minutes: number, bpm: number][]) {
  const heartrate = blocks.flatMap(([minutes, bpm]) =>
    Array.from({ length: minutes * 60 }, () => bpm),
  );
  return { heartrate, time: heartrate.map((_, index) => index) };
}

describe("thresholdEffort", () => {
  test("takes 95 % of the best 20 minutes on a shorter hard effort", () => {
    const { heartrate, time } = stream([15, 120], [20, 170], [15, 120]);
    expect(thresholdEffort(heartrate, time, 190)).toBeCloseTo(161.5);
  });

  test("takes the best hour when it is higher", () => {
    const { heartrate, time } = stream([60, 165]);
    expect(thresholdEffort(heartrate, time, 190)).toBe(165);
  });

  test("drops samples above max HR as spikes", () => {
    const { heartrate, time } = stream([10, 150], [5, 220], [10, 150]);
    expect(thresholdEffort(heartrate, time, 190)).toBeCloseTo(142.5);
  });

  test("has nothing to say about a session shorter than 20 minutes", () => {
    const { heartrate, time } = stream([15, 170]);
    expect(thresholdEffort(heartrate, time, 190)).toBeNull();
  });
});

describe("estimateLthr", () => {
  // Running: 88 % of 190 is 167; hard efforts land between 158 and 177.
  test("is the median of the three hardest efforts", () => {
    expect(estimateLthr([160, 172, 165, 168, 140], 190, "running")).toBe(168);
  });

  test("averages two hard efforts", () => {
    expect(estimateLthr([160, 164], 190, "running")).toBe(162);
  });

  test("falls back to the share of max with fewer than two hard efforts", () => {
    expect(estimateLthr([170], 190, "running")).toBe(167);
    expect(estimateLthr([], 190, "running")).toBe(167);
  });

  test("ignores easy sessions, however many", () => {
    expect(estimateLthr([130, 135, 140, 145, 150, 155], 190, "running")).toBe(167);
  });

  test("caps an estimate above the band", () => {
    expect(estimateLthr([185, 186, 187], 190, "running")).toBe(177);
  });

  test("has no estimate without a max", () => {
    expect(estimateLthr([160, 165], null, "running")).toBeNull();
  });
});
