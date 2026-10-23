import { describe, expect, test } from "vite-plus/test";

import { buildBestEfforts, distanceBests, powerBests } from "./best-efforts.ts";

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

  test("a power spike no rider can hold is dropped", () => {
    expect(powerBests(Array(10).fill(3000), seconds(10), [5])).toEqual([]);
  });

  test("a single spike does not lift longer averages", () => {
    const watts = [...Array(30).fill(200), 30000, ...Array(29).fill(200)];
    // 59 s at 200 W and the spike counted as zero.
    expect(powerBests(watts, seconds(60), [60])).toEqual([{ seconds: 60, watts: 197 }]);
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
    const [oneK] = distanceBests(distance, time, [1000], "run");
    expect(oneK.metres).toBe(1000);
    expect(oneK.seconds).toBe(250);
  });

  test("paused time stops the clock", () => {
    const distance = [0, 500, 500, 1000];
    const time = [0, 150, 750, 900];
    expect(distanceBests(distance, time, [1000], "run")).toEqual([{ metres: 1000, seconds: 300 }]);
  });

  test("sparse samples while moving still count", () => {
    expect(distanceBests([0, 500, 1000], [0, 150, 300], [1000], "run")).toEqual([
      { metres: 1000, seconds: 300 },
    ]);
  });

  test("skips distances longer than the run", () => {
    expect(distanceBests([0, 500, 900], [0, 150, 270], [1000], "run")).toEqual([]);
  });
});

describe("swim bests", () => {
  test("rest at the wall keeps the clock running", () => {
    // 100 m, a 60 s rest, then another 100 m: the 200 m took 240 s, not 180 s.
    const distance = [0, 100, 100, 200];
    const time = [0, 90, 150, 240];
    expect(distanceBests(distance, time, [200], "swim")).toEqual([{ metres: 200, seconds: 240 }]);
  });
});

describe("GPS jumps", () => {
  test("a run faster than the world record is dropped", () => {
    // 400 m in 20 s.
    expect(distanceBests([0, 400], [0, 20], [400], "run")).toEqual([]);
  });

  test("a ride faster than 80 km/h over 10 km is dropped", () => {
    // 10 km in 6 minutes is 100 km/h.
    expect(distanceBests([0, 10000], [0, 360], [10000], "ride")).toEqual([]);
    expect(distanceBests([0, 10000], [0, 900], [10000], "ride")).toEqual([
      { metres: 10000, seconds: 900 },
    ]);
  });
});

describe("which bests an activity holds", () => {
  // 20 km at a steady 5 m/s with power, one sample a second.
  const time = seconds(4001);
  const streams = {
    time,
    distance: time.map((second) => second * 5),
    watts: time.map(() => 200),
    altitude: null,
  };

  test("an outdoor ride with a power meter holds power and ride distances", () => {
    const bests = buildBestEfforts({ ...streams, sportType: "Ride", deviceWatts: true });
    expect(bests.power.find((best) => best.seconds === 1200)?.watts).toBe(200);
    expect(bests.ride.map((best) => best.metres)).toEqual([10000, 20000]);
    expect(bests.run).toEqual([]);
  });

  test("a virtual ride holds power but no speed, an e-bike holds neither", () => {
    const virtual = buildBestEfforts({ ...streams, sportType: "VirtualRide", deviceWatts: true });
    expect(virtual.power.length).toBeGreaterThan(0);
    expect(virtual.ride).toEqual([]);
    const ebike = buildBestEfforts({ ...streams, sportType: "EBikeRide", deviceWatts: true });
    expect(ebike.power).toEqual([]);
    expect(ebike.ride).toEqual([]);
  });

  test("road runs hold run distances, trail runs do not", () => {
    const run = { ...streams, distance: time.map((second) => second * 3), deviceWatts: false };
    expect(buildBestEfforts({ ...run, sportType: "Run" }).run.length).toBeGreaterThan(0);
    expect(buildBestEfforts({ ...run, sportType: "TrailRun" }).run).toEqual([]);
  });

  test("the biggest climb is kept with its length and gradient", () => {
    // 6 km flat, 4 km at 8 %, 10 km flat.
    const altitude = streams.distance.map((metres) =>
      Math.min(320, Math.max(0, metres - 6000) * 0.08),
    );
    const bests = buildBestEfforts({ ...streams, altitude, sportType: "Ride", deviceWatts: true });
    expect(bests.climb?.gainM).toBeGreaterThan(300);
    expect(bests.climb?.avgGradePct).toBeCloseTo(8, 0);
  });

  test("swims hold swim distances", () => {
    const swim = { ...streams, distance: time.map((second) => second), deviceWatts: false };
    const bests = buildBestEfforts({ ...swim, sportType: "Swim" });
    expect(bests.swim.find((best) => best.metres === 400)?.seconds).toBe(400);
  });
});
