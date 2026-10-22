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
  const strapless = run({ averageHeartrate: null, maxHeartrate: null, distance: 12_000 });
  const intensityAt = (bpm: number, lthr: number) => (bpm - 50) / (lthr - 50);

  test("borrows intensity from runs of similar duration and speed before rides", () => {
    const pool = [
      strapless,
      run({ averageHeartrate: 150, distance: 12_000 }),
      run({ averageHeartrate: 152, distance: 12_100 }),
      run({ averageHeartrate: 180, movingTime: 1200, distance: 5000 }),
      ride({ averageHeartrate: 110, deviceWatts: false, distance: 12_000 }),
    ];
    const intensity = estimateHrIntensity(strapless, pool, ANCHORS);
    expect(intensity).toBeGreaterThan(intensityAt(150, 175));
    expect(intensity).toBeLessThan(intensityAt(160, 175));
  });

  test("scores the borrowed intensity like heart rate and flags it as estimated", () => {
    const pool = [strapless, run({ averageHeartrate: 154, distance: 12_000 })];
    const result = activityTrainingLoad(strapless, ANCHORS, pool);
    expect(result.source).toBe("similarHeartRate");
    expect(result.estimatedHeartrate).toBe(154);
    expect(result.load).toBeCloseTo(activityTrainingLoad(run(), ANCHORS).load, 5);
    expect(toFitnessLoad(new Date(), result.load, result.source).estimatedLoad).toBe(result.load);
  });

  test("every sport gets an estimate, borrowing across sport groups when it has to", () => {
    const pool = [run({ averageHeartrate: 154 })];
    for (const sportType of ["Walk", "Swim", "Ride", "Yoga", "WeightTraining", "Kayaking"]) {
      const activity = run({ sportType, averageHeartrate: null, maxHeartrate: null });
      expect(activityTrainingLoad(activity, ANCHORS, [activity, ...pool]).source).toBe(
        "similarHeartRate",
      );
    }
  });

  test("only borrows heart rate recorded from 2026 on", () => {
    const old = run({ averageHeartrate: 154, startDate: "2025-12-31T08:00:00Z" });
    const recent = run({ averageHeartrate: 154, startDate: "2026-01-01T08:00:00Z" });
    const target = { ...strapless, startDate: "2024-06-01T08:00:00Z" };
    expect(activityTrainingLoad(target, ANCHORS, [target, old]).source).toBe("duration");
    expect(activityTrainingLoad(target, ANCHORS, [target, recent]).source).toBe("similarHeartRate");
  });

  test("falls back to duration when no activity recorded heart rate", () => {
    const pool = [strapless];
    expect(activityTrainingLoad(strapless, ANCHORS, pool).source).toBe("duration");
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
