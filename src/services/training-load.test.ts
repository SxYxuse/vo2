import { describe, expect, test } from "vite-plus/test";

import { normalizedPowerFromWatts } from "./normalized-power.ts";
import {
  activityTrainingLoad,
  buildPmc,
  ctlChange,
  estimateLoadAnchors,
  formAfterLoad,
  formLabel,
  pmcWithCurrentForm,
  mergeLoadAnchors,
  pickLoadAnchorsFromTests,
  type LoadAnchors,
  type LoadInputs,
} from "./training-load.ts";
import { formForRemainingWeek, planRemainingWeek } from "./training-plan.types.ts";

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
  test("field-test FTP and sport LTHR beat estimates", () => {
    const estimated = estimateLoadAnchors([
      ride({ movingTime: 50 * 60, weightedAverageWatts: 200, maxHeartrate: 185 }),
      run({ maxHeartrate: 195, averageHeartrate: 150 }),
    ]);
    const merged = mergeLoadAnchors(
      estimated,
      pickLoadAnchorsFromTests([
        {
          assessmentId: "ftp-20",
          result: { ftpWatts: 260, cyclingLthr: 168, peakHr: 188 },
        },
        { assessmentId: "run-lthr", result: { runLthr: 178 } },
      ]),
    );
    expect(merged.ftp).toBe(260);
    expect(merged.cyclingLthr).toBe(168);
    expect(merged.runLthr).toBe(178);
    expect(merged.cyclingLthr).not.toBe(merged.runLthr);
  });

  test("estimates LTHR per sport from that sport's peak HR", () => {
    const estimated = estimateLoadAnchors([
      ride({ maxHeartrate: 180, deviceWatts: false }),
      run({ maxHeartrate: 200, averageHeartrate: 140 }),
    ]);
    expect(estimated.cyclingLthr).toBe(Math.round(180 * 0.83));
    expect(estimated.runLthr).toBe(Math.round(200 * 0.88));
  });
});

describe("remaining week", () => {
  const plan = {
    buildPace: "fast" as const,
    maxRunSessions: 3,
    maxRideSessions: 3,
    maxDoubleDays: 0,
    hoursIntent: "keep" as const,
    workoutStyle: "structured" as const,
    targetWeeklyHours: 8,
    preferredRestWeekday: 0,
    suggestFtpTest: true,
    suggestBeepTest: true,
    suggestRunLthrTest: true,
    timeZone: "UTC",
  };

  test("structured fast build still schedules quality when form is productively negative", () => {
    const vo2 = planRemainingWeek({
      plan,
      today: "2026-10-16",
      ctl: 50,
      tsb: -8,
      completed: [],
    });
    const threshold = planRemainingWeek({
      plan,
      today: "2026-10-16",
      ctl: 50,
      tsb: -18,
      completed: [],
    });
    expect(vo2.some((session) => session.title.includes("VO2"))).toBe(true);
    expect(threshold.some((session) => session.title.includes("Threshold"))).toBe(true);
  });

  test("very fatigued form drops quality", () => {
    const sessions = planRemainingWeek({
      plan,
      today: "2026-10-16",
      ctl: 50,
      tsb: -35,
      completed: [],
    });
    expect(sessions.every((session) => !/VO2|Threshold|Tempo|Sweet-spot/.test(session.title))).toBe(
      true,
    );
  });

  test("remaining-week form uses end of day after today's completed load", () => {
    const pmc = { ctl: 52, atl: 64, tsb: 1 };
    expect(formForRemainingWeek(pmc, "2026-10-16", [{ date: "2026-10-16", load: 150 }])).toBe(-12);
    expect(formForRemainingWeek(pmc, "2026-10-16", [])).toBe(1);
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
