import { describe, expect, test } from "vite-plus/test";

import {
  buildRideAnalysis,
  isRideAnalysis,
  summarizeRide,
  variabilityLabel,
  type RideStreams,
} from "./ride-analysis.ts";

/** 1 Hz ride: `flat` seconds at 0 %, then `climb` seconds at 5 %, then `descent` seconds at -5 %. */
function rideStreams(
  { flat = 600, climb = 300, descent = 300 } = {},
  overrides: Partial<RideStreams> = {},
): RideStreams {
  const length = flat + climb + descent;
  const time: number[] = [];
  const grade: number[] = [];
  const watts: number[] = [];
  const cadence: number[] = [];
  const speed: number[] = [];
  const heartrate: number[] = [];
  for (let index = 0; index < length; index += 1) {
    time.push(index);
    if (index < flat) {
      grade.push(0);
      watts.push(200);
      cadence.push(90);
      speed.push(9);
      heartrate.push(140);
    } else if (index < flat + climb) {
      grade.push(5);
      watts.push(260);
      cadence.push(72);
      speed.push(4);
      heartrate.push(160);
    } else {
      grade.push(-5);
      watts.push(0);
      cadence.push(0);
      speed.push(14);
      heartrate.push(130);
    }
  }
  return {
    time,
    distance: null,
    altitude: null,
    gradeSmooth: grade,
    watts,
    cadence,
    velocitySmooth: speed,
    heartrate,
    moving: null,
    ...overrides,
  };
}

describe("buildRideAnalysis", () => {
  test("splits moving time into grade bands with power, cadence, speed, and HR", () => {
    const analysis = buildRideAnalysis(rideStreams());
    const labels = analysis.bands.map((band) => band.label);
    expect(labels).toEqual(["Descent", "Flat / rolling", "Climb"]);

    const flat = analysis.bands.find((band) => band.label === "Flat / rolling");
    const climb = analysis.bands.find((band) => band.label === "Climb");
    expect(flat?.durationSec).toBe(600);
    expect(flat?.avgWatts).toBe(200);
    expect(flat?.avgCadence).toBe(90);
    expect(flat?.avgSpeedKmh).toBeCloseTo(32.4, 1);
    expect(climb?.avgWatts).toBe(260);
    expect(climb?.avgCadence).toBe(72);
    expect(climb?.avgHeartrate).toBe(160);
  });

  test("counts coasting as zero cadence while moving, and keeps zeros in average power", () => {
    const analysis = buildRideAnalysis(rideStreams());
    const descent = analysis.bands.find((band) => band.label === "Descent");
    expect(descent?.avgCadence).toBeNull();
    expect(descent?.coastingPct).toBe(100);
    // the last sample has no following interval, so moving time is one second short
    expect(analysis.movingSec).toBe(1199);
    expect(analysis.coastingSec).toBe(299);
    expect(analysis.avgWatts).toBeCloseTo((600 * 200 + 300 * 260) / 1199, 0);
  });

  test("skips stopped samples", () => {
    const streams = rideStreams();
    const moving = streams.time!.map((_, index) => index < 100 || index >= 600);
    const analysis = buildRideAnalysis({ ...streams, moving });
    const flat = analysis.bands.find((band) => band.label === "Flat / rolling");
    expect(flat?.durationSec).toBe(100);
  });

  test("derives grade from altitude and distance when Strava sent no grade stream", () => {
    const length = 400;
    const time = Array.from({ length }, (_, index) => index);
    const distance = time.map((t) => t * 5);
    const altitude = distance.map((d) => d * 0.08);
    const analysis = buildRideAnalysis({
      time,
      distance,
      altitude,
      gradeSmooth: null,
      watts: time.map(() => 280),
      cadence: time.map(() => 70),
      velocitySmooth: time.map(() => 5),
      heartrate: null,
      moving: null,
    });
    expect(analysis.bands.map((band) => band.label)).toEqual(["Steep climb"]);
    expect(analysis.bands[0].distanceM).toBeGreaterThan(1900);
  });

  test("flags missing power and cadence streams", () => {
    const analysis = buildRideAnalysis(rideStreams({}, { watts: null, cadence: null }));
    expect(analysis.hasPower).toBe(false);
    expect(analysis.hasCadence).toBe(false);
    expect(analysis.coastingSec).toBeNull();
    expect(analysis.bands.every((band) => band.avgWatts == null)).toBe(true);
  });

  test("round-trips through the cache guard", () => {
    const analysis = buildRideAnalysis(rideStreams());
    expect(isRideAnalysis(JSON.parse(JSON.stringify(analysis)))).toBe(true);
    expect(isRideAnalysis({ ...analysis, version: 0 })).toBe(false);
    expect(isRideAnalysis(null)).toBe(false);
  });
});

describe("summarizeRide", () => {
  const analysis = buildRideAnalysis(rideStreams());

  test("uses Strava's NP and average power for VI, and FTP for IF and TSS", () => {
    const summary = summarizeRide(analysis, {
      sportType: "Ride",
      movingTime: 3600,
      averageWatts: 200,
      normalizedWatts: 220,
      deviceWatts: true,
      ftp: 250,
    });
    expect(summary?.variabilityIndex).toBeCloseTo(1.1, 5);
    expect(summary?.intensityFactor).toBeCloseTo(0.88, 5);
    expect(summary?.tss).toBeCloseTo(77.44, 5);
    expect(summary?.coastingPct).toBeCloseTo(24.9, 1);
    expect(summary?.estimatedPower).toBe(false);
  });

  test("falls back to stream power when Strava has no summary watts", () => {
    const summary = summarizeRide(analysis, {
      sportType: "Ride",
      movingTime: 1200,
      averageWatts: null,
      normalizedWatts: null,
      deviceWatts: true,
      ftp: null,
    });
    expect(summary?.variabilityIndex).toBeGreaterThan(1);
    expect(summary?.intensityFactor).toBeNull();
    expect(summary?.tss).toBeNull();
  });

  test("never scores IF or TSS from estimated power or e-bikes", () => {
    const base = {
      movingTime: 3600,
      averageWatts: 200,
      normalizedWatts: 220,
      ftp: 250,
    };
    const estimated = summarizeRide(analysis, { ...base, sportType: "Ride", deviceWatts: false });
    expect(estimated?.estimatedPower).toBe(true);
    expect(estimated?.intensityFactor).toBeNull();
    expect(estimated?.tss).toBeNull();

    const ebike = summarizeRide(analysis, { ...base, sportType: "EBikeRide", deviceWatts: true });
    expect(ebike?.intensityFactor).toBeNull();
  });

  test("is null when the ride has neither power nor cadence", () => {
    const bare = buildRideAnalysis(rideStreams({}, { watts: null, cadence: null }));
    expect(
      summarizeRide(bare, {
        sportType: "Ride",
        movingTime: 3600,
        averageWatts: null,
        normalizedWatts: null,
        deviceWatts: false,
        ftp: 250,
      }),
    ).toBeNull();
  });
});

describe("variabilityLabel", () => {
  test("names steady, mixed, and surgy rides", () => {
    expect(variabilityLabel(1.03)).toBe("Steady");
    expect(variabilityLabel(1.0526)).toBe("Steady");
    expect(variabilityLabel(1.1)).toBe("Mixed");
    expect(variabilityLabel(1.25)).toBe("Surgy");
  });
});
