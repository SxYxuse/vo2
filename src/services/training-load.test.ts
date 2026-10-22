import { describe, expect, test } from "vite-plus/test";

import { normalizedPowerFromWatts } from "./normalized-power.ts";
import {
  activityTrainingLoad,
  buildPmc,
  ctlChange,
  estimateHrIntensity,
  estimateLoadAnchors,
  formAfterLoad,
  formLabel,
  pmcWithCurrentForm,
  toFitnessLoad,
  type LoadAnchors,
  type LoadInputs,
} from "./training-load.ts";

const ANCHORS: LoadAnchors = {
  ftp: 250,
  cyclingLthr: 160,
  runLthr: 175,
  swimLthr: 155,
  restHr: 50,
  cyclingMaxHr: 190,
  runMaxHr: 198,
  swimMaxHr: 180,
  walkingMaxHr: 170,
  otherMaxHr: 185,
};

function ride(overrides: Partial<LoadInputs> = {}): LoadInputs {
  return {
    sportType: "Ride",
    movingTime: 3600,
    averageHeartrate: null,
    maxHeartrate: null,
    averageWatts: 180,
    weightedAverageWatts: 250,
    deviceWatts: true,
    ...overrides,
  };
}

function run(overrides: Partial<LoadInputs> = {}): LoadInputs {
  return {
    sportType: "Run",
    movingTime: 3600,
    averageHeartrate: 154,
    maxHeartrate: 180,
    averageWatts: null,
    weightedAverageWatts: null,
    deviceWatts: false,
    ...overrides,
  };
}

describe("training load", () => {
  test("one hour at FTP is 100", () => {
    const { load, source } = activityTrainingLoad(ride(), ANCHORS);
    expect(source).toBe("power");
    expect(load).toBeCloseTo(100, 5);
  });

  test("does not clamp intensity above 1.2", () => {
    const { load } = activityTrainingLoad(
      ride({ weightedAverageWatts: 312.5, movingTime: 3600 }),
      ANCHORS,
    );
    expect(load).toBeCloseTo(156.25, 5);
  });

  test("uses stream NP when Strava weighted watts is missing", () => {
    const watts = Array.from({ length: 60 }, () => 250);
    const time = watts.map((_, index) => index);
    const { load, source } = activityTrainingLoad(
      ride({ weightedAverageWatts: null, averageWatts: 180, wattsStream: watts, timeStream: time }),
      ANCHORS,
    );
    expect(source).toBe("power");
    expect(load).toBeCloseTo(100, 0);
  });

  test("does not use average watts as normalized power", () => {
    const { source } = activityTrainingLoad(
      ride({ weightedAverageWatts: null, averageWatts: 250 }),
      ANCHORS,
    );
    expect(source).not.toBe("power");
  });

  test("e-bike power does not score against FTP", () => {
    const { source } = activityTrainingLoad(
      ride({ sportType: "EBikeRide", weightedAverageWatts: 250 }),
      ANCHORS,
    );
    expect(source).not.toBe("power");
  });

  test("run heart-rate load uses running LTHR, not cycling", () => {
    const runLoad = activityTrainingLoad(run(), ANCHORS).load;
    const ifCopiedBike = activityTrainingLoad(run(), {
      ...ANCHORS,
      runLthr: ANCHORS.cyclingLthr,
    }).load;
    expect(runLoad).toBeLessThan(ifCopiedBike);
    const intensity = (154 - 50) / (175 - 50);
    expect(runLoad).toBeCloseTo(100 * intensity * intensity, 5);
  });

  test("zero moving time is training load 0", () => {
    const { load } = activityTrainingLoad(ride({ movingTime: 0 }), ANCHORS);
    expect(load).toBe(0);
  });
});

describe("heart rate from similar activities", () => {
  const day = (offset: number) =>
    new Date(Date.UTC(2026, 5, 1) + offset * 86_400_000).toISOString();
  const strapless = run({
    averageHeartrate: null,
    maxHeartrate: null,
    distance: 12_000,
    startDate: day(0),
  });
  const runAt = (bpm: number, offset: number, overrides: Partial<LoadInputs> = {}) =>
    run({ averageHeartrate: bpm, distance: 12_000, startDate: day(offset), ...overrides });
  const intensityAt = (bpm: number) => (bpm - 50) / (175 - 50);

  test("scores the median borrowed intensity like heart rate and flags it as estimated", () => {
    const pool = [strapless, runAt(150, -3), runAt(154, 4), runAt(158, -10)];
    const result = activityTrainingLoad(strapless, ANCHORS, pool);
    expect(result.source).toBe("similarHeartRate");
    expect(result.estimatedHeartrate).toBe(154);
    expect(result.load).toBeCloseTo(activityTrainingLoad(run(), ANCHORS).load, 5);
    expect(toFitnessLoad(new Date(), result.load, result.source).estimatedLoad).toBe(result.load);
  });

  test("one bad sensor day does not move the median", () => {
    const pool = [strapless, runAt(150, -3), runAt(154, 4), runAt(196, -1)];
    expect(estimateHrIntensity(strapless, pool, ANCHORS)).toBeCloseTo(intensityAt(154), 5);
  });

  test("needs three matches within two months either side", () => {
    const tooFew = [strapless, runAt(150, -3), runAt(154, 4)];
    expect(activityTrainingLoad(strapless, ANCHORS, tooFew).source).toBe("duration");
    const tooFar = [...tooFew, runAt(158, 61)];
    expect(activityTrainingLoad(strapless, ANCHORS, tooFar).source).toBe("duration");
    const inWindow = [...tooFew, runAt(158, 60)];
    expect(activityTrainingLoad(strapless, ANCHORS, inWindow).source).toBe("similarHeartRate");
  });

  test("only borrows from the same sport group", () => {
    const walk = { ...strapless, sportType: "Walk" };
    const runs = [runAt(150, -3), runAt(154, 4), runAt(158, -10)];
    expect(activityTrainingLoad(walk, ANCHORS, [walk, ...runs]).source).toBe("duration");
    const trail = { ...strapless, sportType: "TrailRun" };
    expect(activityTrainingLoad(trail, ANCHORS, [trail, ...runs]).source).toBe("similarHeartRate");
  });

  test("mixed sports only borrow from the same sport type", () => {
    const yoga = { ...strapless, sportType: "Yoga" };
    const gym = [130, 132, 134].map((bpm, index) =>
      runAt(bpm, index, { sportType: "WeightTraining" }),
    );
    expect(activityTrainingLoad(yoga, ANCHORS, [yoga, ...gym]).source).toBe("duration");
  });
});

describe("PMC form", () => {
  test("today's form is morning TSB, before today's load", () => {
    const start = new Date();
    const points = buildPmc(
      [{ start: start.toISOString(), load: 150, estimatedLoad: 0, movingTime: 3600 }],
      "UTC",
    );
    const today = points.at(-1);
    expect(today).toBeDefined();
    expect(today!.tsb).toBeCloseTo(0, 5);
    expect(today!.ctl).toBeCloseTo(150 / 42, 5);
    expect(today!.atl).toBeCloseTo(150 / 7, 5);
    expect(formAfterLoad(today!)).toBeCloseTo(150 / 42 - 150 / 7, 5);
  });

  test("graph form is after today's known load, not morning TSB", () => {
    const start = new Date();
    const points = buildPmc(
      [{ start: start.toISOString(), load: 150, estimatedLoad: 0, movingTime: 3600 }],
      "UTC",
    );
    const watched = pmcWithCurrentForm(points).at(-1);
    expect(watched).toBeDefined();
    expect(watched!.tsb).toBeCloseTo(150 / 42 - 150 / 7, 5);
    expect(watched!.tsb).toBeLessThan(0);
    expect(watched!.ctl).toBeCloseTo(150 / 42, 5);
    expect(watched!.atl).toBeCloseTo(150 / 7, 5);
  });

  test("7-day ramp uses the full series, not a 6-day window", () => {
    const now = Date.now();
    const loads = Array.from({ length: 10 }, (_, index) => ({
      start: new Date(now - (9 - index) * 86_400_000).toISOString(),
      load: index === 9 ? 100 : 40,
      estimatedLoad: 0,
      movingTime: 3600,
    }));
    const pmc = buildPmc(loads, "UTC");
    expect(pmc.length).toBeGreaterThanOrEqual(8);
    const expected = pmc[pmc.length - 1].ctl - pmc[pmc.length - 8].ctl;
    expect(ctlChange(pmc, 7)).toBeCloseTo(expected, 8);
  });
});

describe("anchors", () => {
  test("estimates LTHR per sport from that sport's peak HR", () => {
    const estimated = estimateLoadAnchors([
      ride({ maxHeartrate: 180, deviceWatts: false }),
      run({ maxHeartrate: 200, averageHeartrate: 140 }),
    ]);
    expect(estimated.cyclingLthr).toBe(Math.round(180 * 0.83));
    expect(estimated.runLthr).toBe(Math.round(200 * 0.88));
  });
});

describe("labels and NP", () => {
  test("form bands follow Coggan-style race and caution lines", () => {
    expect(formLabel(26)).toBe("Very fresh");
    expect(formLabel(10)).toBe("Fresh");
    expect(formLabel(0)).toBe("Neutral");
    expect(formLabel(-20)).toBe("Fatigued");
    expect(formLabel(-31)).toBe("Very fatigued");
  });

  test("steady watts over 30s is NP", () => {
    const watts = Array.from({ length: 60 }, () => 200);
    expect(
      normalizedPowerFromWatts(
        watts,
        watts.map((_, index) => index),
      ),
    ).toBeCloseTo(200, 0);
  });
});
