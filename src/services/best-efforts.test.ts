import { describe, expect, test } from "vite-plus/test";

import { powerBests, runBests } from "./best-efforts.ts";

function seconds(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

describe("power bests", () => {
  test("finds the best average over each duration", () => {
    const watts = [...Array(600).fill(150), ...Array(300).fill(300), ...Array(600).fill(150)];
    const bests = powerBests(watts, seconds(watts.length), [60, 300, 1200]);
    expect(bests).toEqual([
      { seconds: 60, watts: 300 },
      { seconds: 300, watts: 300 },
      // 300 s at 300 W and 900 s at 150 W.
      { seconds: 1200, watts: 188 },
    ]);
  });

  test("a long pause counts as zero, not as the last power held", () => {
    const time = [...seconds(60), 660, ...seconds(60).map((value) => 661 + value)];
    const watts = Array(time.length).fill(200);
    const [best] = powerBests(watts, time, [300]);
    // Only 121 s of riding fall in any 300 s window around the stop.
    expect(best.watts).toBeLessThan(100);
  });

  test("skips durations longer than the ride", () => {
    expect(powerBests(Array(100).fill(200), seconds(100), [60, 300])).toEqual([
      { seconds: 60, watts: 200 },
    ]);
  });
});

describe("run bests", () => {
  test("finds the fastest stretch over each distance", () => {
    // 2 km at 3 m/s, then 1 km at 4 m/s.
    const distance: number[] = [];
    const time: number[] = [];
    let at = 0;
    for (let second = 0; second <= 917; second += 1) {
      distance.push(at);
      time.push(second);
      at += second < 667 ? 3 : 4;
    }
    const [oneK] = runBests(distance, time, [1000]);
    expect(oneK.metres).toBe(1000);
    expect(oneK.seconds).toBe(250);
  });

  test("paused time stops the clock", () => {
    const distance = [0, 500, 500, 1000];
    const time = [0, 150, 750, 900];
    expect(runBests(distance, time, [1000])).toEqual([{ metres: 1000, seconds: 300 }]);
  });

  test("sparse samples while moving still count", () => {
    expect(runBests([0, 500, 1000], [0, 150, 300], [1000])).toEqual([
      { metres: 1000, seconds: 300 },
    ]);
  });

  test("skips distances longer than the run", () => {
    expect(runBests([0, 500, 900], [0, 150, 270], [1000])).toEqual([]);
  });
});
