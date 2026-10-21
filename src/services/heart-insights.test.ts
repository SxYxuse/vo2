import { describe, expect, test } from "vite-plus/test";

import {
  buildHeartAnalysis,
  computeDecoupling,
  denseHistogram,
  efficiencyFactor,
  efficiencyNorm,
  efficiencyTrendSummary,
  estimateMaxHrAnchor,
  explainHeartGap,
  peakSustainedHeartrates,
  predictedMaxHr,
  toEfficiencyPoint,
  usualHeartrate,
  type EfficiencyInput,
  type EfficiencyPoint,
  type HeartStreams,
} from "./heart-insights.ts";
import {
  addSessionToSport,
  createSportBucket,
  emptyHistogram,
  noteActivityPeak,
  sportForPeriod,
  toHeartRateSport,
} from "./heart-rate.ts";

const NOW = new Date("2026-10-19T12:00:00Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("estimateMaxHrAnchor", () => {
  test("uses the highest recent peak and checks it against age", () => {
    const anchor = estimateMaxHrAnchor(
      [
        { bpm: 186, start: daysAgo(30), avgBpm: 165 },
        { bpm: 182, start: daysAgo(60), avgBpm: 150 },
      ],
      { family: "cycling", age: 40, now: NOW },
    );
    expect(predictedMaxHr(40)).toBe(180);
    expect(anchor.bpm).toBe(186);
    expect(anchor.source).toBe("recent");
    expect(anchor.ageCheck).toBe("matches");
  });

  test("ignores peaks older than the window when recent ones exist", () => {
    const anchor = estimateMaxHrAnchor(
      [
        { bpm: 198, start: daysAgo(900), avgBpm: 170 },
        { bpm: 184, start: daysAgo(20), avgBpm: 160 },
      ],
      { family: "running", now: NOW },
    );
    expect(anchor.bpm).toBe(184);
  });

  test("falls back to older peaks, then to age", () => {
    const older = estimateMaxHrAnchor([{ bpm: 190, start: daysAgo(900) }], {
      family: "running",
      now: NOW,
    });
    expect(older).toMatchObject({ bpm: 190, source: "older" });
    const fromAge = estimateMaxHrAnchor([], { family: "running", age: 30, now: NOW });
    expect(fromAge).toMatchObject({ bpm: 187, source: "age", peak: null });
  });

  test("drops an isolated spike on an easy session but keeps a race peak", () => {
    const spike = estimateMaxHrAnchor(
      [
        { bpm: 212, start: daysAgo(5), avgBpm: 128, name: "Easy spin" },
        { bpm: 184, start: daysAgo(10), avgBpm: 160 },
        { bpm: 181, start: daysAgo(15), avgBpm: 150 },
      ],
      { family: "cycling", now: NOW },
    );
    expect(spike.bpm).toBe(184);
    expect(spike.excluded).toEqual([expect.objectContaining({ bpm: 212, reason: "isolated" })]);

    const race = estimateMaxHrAnchor(
      [
        { bpm: 196, start: daysAgo(5), avgBpm: 176 },
        { bpm: 184, start: daysAgo(10), avgBpm: 160 },
      ],
      { family: "running", now: NOW },
    );
    expect(race.bpm).toBe(196);
    expect(race.excluded).toEqual([]);
  });

  test("drops peaks far above the age prediction and flags a low max", () => {
    const anchor = estimateMaxHrAnchor(
      [
        { bpm: 215, start: daysAgo(5), avgBpm: 170 },
        { bpm: 160, start: daysAgo(10), avgBpm: 140 },
      ],
      { family: "cycling", age: 40, now: NOW },
    );
    expect(anchor.excluded[0]).toMatchObject({ bpm: 215, reason: "above-age" });
    expect(anchor.bpm).toBe(160);
    expect(anchor.ageCheck).toBe("below");
  });
});

/** 1 Hz steady session: `minutes` long, output and HR from callbacks of elapsed seconds. */
function steadyStreams(
  minutes: number,
  output: (t: number) => number,
  heartrate: (t: number) => number,
  key: "watts" | "velocitySmooth" = "watts",
): HeartStreams {
  const time: number[] = [];
  const hr: number[] = [];
  const values: number[] = [];
  for (let t = 0; t < minutes * 60; t += 1) {
    time.push(t);
    hr.push(heartrate(t));
    values.push(output(t));
  }
  return {
    time,
    heartrate: hr,
    watts: key === "watts" ? values : null,
    velocitySmooth: key === "velocitySmooth" ? values : null,
    moving: null,
    temp: time.map(() => 22),
  };
}

const RIDE_CONTEXT = {
  family: "cycling" as const,
  sportType: "Ride",
  distance: 40_000,
  totalElevationGain: 200,
};

describe("computeDecoupling", () => {
  test("measures HR drift against steady power after warm-up", () => {
    const result = computeDecoupling(
      steadyStreams(
        90,
        () => 200,
        (t) => 140 + (t / (90 * 60)) * 14,
      ),
      RIDE_CONTEXT,
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.output).toBe("power");
    expect(result.pct).toBeGreaterThan(3);
    expect(result.pct).toBeLessThan(6);
    expect(result.secondHalf.avgHeartrate).toBeGreaterThan(result.firstHalf.avgHeartrate);
  });

  test("judges steadiness from minute means when samples are too sparse for NP", () => {
    const sparse = steadyStreams(
      60,
      () => 200,
      () => 145,
    );
    const every10s = (values: number[] | null) =>
      values?.filter((_, index) => index % 10 === 0) ?? null;
    const result = computeDecoupling(
      {
        ...sparse,
        time: every10s(sparse.time),
        heartrate: every10s(sparse.heartrate),
        watts: every10s(sparse.watts),
        temp: null,
      },
      RIDE_CONTEXT,
    );
    expect(result).toMatchObject({ status: "ok", pct: 0 });
  });

  test("skips short, surgy, hilly, and output-less sessions", () => {
    expect(
      computeDecoupling(
        steadyStreams(
          30,
          () => 200,
          () => 140,
        ),
        RIDE_CONTEXT,
      ),
    ).toEqual({
      status: "skipped",
      reason: "short",
    });
    const intervals = steadyStreams(
      60,
      (t) => (Math.floor(t / 60) % 2 ? 380 : 60),
      () => 150,
    );
    expect(computeDecoupling(intervals, RIDE_CONTEXT)).toEqual({
      status: "skipped",
      reason: "unsteady",
    });
    const run = steadyStreams(
      60,
      () => 3.2,
      () => 150,
      "velocitySmooth",
    );
    expect(
      computeDecoupling(run, {
        family: "running",
        sportType: "Run",
        distance: 11_000,
        totalElevationGain: 400,
      }),
    ).toEqual({ status: "skipped", reason: "hilly" });
    expect(
      computeDecoupling(run, {
        family: "swimming",
        sportType: "Swim",
        distance: 3000,
        totalElevationGain: 0,
      }),
    ).toEqual({ status: "skipped", reason: "no-output" });
  });

  test("buildHeartAnalysis stores a sparse histogram and temperature", () => {
    const analysis = buildHeartAnalysis(
      steadyStreams(
        50,
        () => 200,
        () => 150,
      ),
      RIDE_CONTEXT,
    );
    expect(analysis.histogram).toEqual([[150, 3000]]);
    expect(denseHistogram(analysis.histogram)[150]).toBe(3000);
    expect(analysis.avgTempC).toBe(22);
  });
});

function ride(overrides: Partial<EfficiencyInput> = {}): EfficiencyInput {
  return {
    sportType: "Ride",
    movingTime: 3600,
    distance: 30_000,
    totalElevationGain: 300,
    averageHeartrate: 140,
    averageWatts: 180,
    weightedAverageWatts: 196,
    deviceWatts: true,
    ...overrides,
  };
}

describe("efficiency", () => {
  test("uses normalized power on metered rides and speed on flat runs", () => {
    expect(efficiencyFactor(ride())).toMatchObject({ kind: "power", output: 196, ef: 1.4 });
    expect(efficiencyFactor(ride({ deviceWatts: false }))).toBeNull();
    expect(efficiencyFactor(ride({ movingTime: 600 }))).toBeNull();
    const run = efficiencyFactor({
      ...ride({ sportType: "Run", averageHeartrate: 150, deviceWatts: false }),
      distance: 12_000,
      totalElevationGain: 50,
    });
    expect(run).toMatchObject({ kind: "speed", output: 200 });
    expect(
      efficiencyFactor({ ...ride({ sportType: "TrailRun" }), totalElevationGain: 50 }),
    ).toBeNull();
  });

  test("marks sessions above the top of zone 3 as not aerobic", () => {
    const point = toEfficiencyPoint({ ...ride({ averageHeartrate: 168 }), start: daysAgo(1) }, 170);
    expect(point?.aerobic).toBe(false);
  });

  function points(count: number): EfficiencyPoint[] {
    return Array.from({ length: count }, (_, index) => {
      const output = 150 + index * 10;
      return {
        start: daysAgo(index + 1),
        ef: output / (110 + output * 0.15),
        output,
        avgHeartrate: 110 + output * 0.15,
        aerobic: true,
      };
    });
  }

  test("norm is the median of recent aerobic sessions", () => {
    const norm = efficiencyNorm(points(5), NOW.toISOString());
    expect(norm?.count).toBe(5);
    expect(efficiencyNorm(points(2), NOW.toISOString())).toBeNull();
  });

  test("usual HR follows the athlete's own HR–output line without extrapolating", () => {
    const history = points(8);
    expect(usualHeartrate(history, NOW.toISOString(), 200)).toEqual({ bpm: 140, count: 8 });
    expect(usualHeartrate(history, NOW.toISOString(), 400)).toBeNull();
    expect(usualHeartrate(history, NOW.toISOString(), 145)).not.toBeNull();
    expect(usualHeartrate(history.slice(0, 4), NOW.toISOString(), 200)).toBeNull();
  });
});

describe("explainHeartGap", () => {
  test("blames fatigue first, then heat, then flags the unexplained", () => {
    expect(explainHeartGap({ gapBpm: 7, tsb: -18, tempC: 30 }).title).toBe(
      "Higher than usual: fatigue",
    );
    expect(explainHeartGap({ gapBpm: 7, tsb: 2, tempC: 30 }).title).toBe("Higher than usual: heat");
    expect(explainHeartGap({ gapBpm: 7, tsb: 2, tempC: 15 }).tone).toBe("warning");
    expect(explainHeartGap({ gapBpm: -6, tsb: -25, tempC: null }).title).toBe(
      "Lower than usual while fatigued",
    );
    expect(explainHeartGap({ gapBpm: -6, tsb: 5, tempC: null }).tone).toBe("positive");
    expect(explainHeartGap({ gapBpm: 2, tsb: null, tempC: null }).title).toBe("In line with usual");
  });
});

describe("efficiencyTrendSummary", () => {
  test("reads rising fitness with rising efficiency as aerobic gains", () => {
    const weeks = [1.3, 1.31, 1.34, 1.36].map((ef, index) => ({
      week: `2026-09-0${index + 1}`,
      ef,
      count: 2,
      ctl: 40 + index * 3,
    }));
    const summary = efficiencyTrendSummary(weeks);
    expect(summary?.efPct).toBeGreaterThan(2);
    expect(summary?.ctlChange).toBe(9);
    expect(summary?.text).toMatch(/aerobic gains/);
  });

  test("needs at least four weeks", () => {
    expect(efficiencyTrendSummary([{ week: "2026-09-01", ef: 1, count: 1, ctl: 40 }])).toBeNull();
  });
});

describe("sportForPeriod", () => {
  test("filters time in zone and counts by period but keeps the anchor", () => {
    const bucket = createSportBucket("Ride");
    noteActivityPeak(bucket, { maxHeartrate: 185, name: "Old", start: daysAgo(40) });
    noteActivityPeak(bucket, { maxHeartrate: 170, name: "New", start: daysAgo(2) });
    const sport = toHeartRateSport(bucket, undefined, { now: NOW });
    const histogram = emptyHistogram();
    histogram[120] = 600;
    addSessionToSport(sport, daysAgo(40), histogram);
    addSessionToSport(sport, daysAgo(2), histogram);

    expect(sport.sampleSeconds).toBe(1200);
    const recent = sportForPeriod(sport, new Date(daysAgo(7)).getTime());
    expect(recent.activityCount).toBe(1);
    expect(recent.sampleSeconds).toBe(600);
    expect(recent.maxHeartrate).toBe(185);
    expect(recent.zones.map((zone) => zone.minBpm)).toEqual(sport.zones.map((zone) => zone.minBpm));
    expect(sportForPeriod(sport, null)).toBe(sport);
  });
});

describe("peakSustainedHeartrates", () => {
  test("finds the hardest window instead of the single highest sample", () => {
    // 10 min at 140, 5 min at 170 with one 200 spike, 10 min at 150.
    const heartrate = [
      ...Array.from({ length: 600 }, () => 140),
      ...Array.from({ length: 300 }, (_, index) => (index === 150 ? 200 : 170)),
      ...Array.from({ length: 600 }, () => 150),
    ];
    const time = heartrate.map((_, index) => index);
    const peaks = peakSustainedHeartrates(heartrate, time);
    expect(peaks.find((peak) => peak.seconds === 60)?.bpm).toBe(171);
    expect(peaks.find((peak) => peak.seconds === 300)?.bpm).toBe(170);
    expect(peaks.find((peak) => peak.seconds === 1200)?.bpm).toBe(153);
  });

  test("leaves out windows longer than the session and skips dropouts", () => {
    const heartrate = Array.from({ length: 400 }, (_, index) => (index % 50 === 0 ? 0 : 160));
    const peaks = peakSustainedHeartrates(heartrate, null);
    expect(peaks.map((peak) => peak.seconds)).toEqual([60, 300]);
    expect(peaks.every((peak) => peak.bpm === 160)).toBe(true);
  });
});
