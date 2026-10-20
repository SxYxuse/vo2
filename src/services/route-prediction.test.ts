import { describe, expect, it } from "vite-plus/test";

import { GRADE_BANDS } from "./grade-bands.ts";
import type { RideGradeBand } from "./ride-analysis.ts";
import { buildRouteProfile, GpxError, parseGpx } from "./route-gpx.ts";
import {
  predictRoute,
  rankSimilarActivities,
  type HistoryActivity,
  type PredictionInput,
} from "./route-prediction.ts";

const now = new Date("2026-10-20T08:00:00Z");
/** Metres of latitude per degree, close enough for synthetic routes. */
const M_PER_DEG = 111_195;

/** A straight route north with a point every 25 m and elevation from `ele(distanceM)`. */
function gpx(distanceM: number, ele: ((distanceM: number) => number) | null, tag = "trkpt") {
  const points: string[] = [];
  for (let d = 0; d <= distanceM; d += 25) {
    const inner = ele ? `<ele>${ele(d).toFixed(1)}</ele>` : "";
    points.push(
      `<${tag} lat="${(45 + d / M_PER_DEG).toFixed(7)}" lon="6.0000000">${inner}</${tag}>`,
    );
  }
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Test route</name><trkseg>${points.join("")}</trkseg></trk></gpx>`;
}

/** Flat for 10 km, a 6 % climb over 5 km (300 m), then flat again for 15 km. */
const hillyEle = (d: number) => (d < 10_000 ? 200 : d < 15_000 ? 200 + (d - 10_000) * 0.06 : 500);

function profile(distanceM: number, ele: ((distanceM: number) => number) | null) {
  return buildRouteProfile(parseGpx(gpx(distanceM, ele)));
}

function band(index: number, durationSec: number, avgSpeedKmh: number): RideGradeBand {
  const grade = GRADE_BANDS[index];
  if (!grade) throw new Error("no band");
  return {
    label: grade.label,
    minGrade: grade.min,
    maxGrade: grade.max,
    durationSec,
    distanceM: (avgSpeedKmh / 3.6) * durationSec,
    avgWatts: null,
    avgCadence: null,
    avgSpeedKmh,
    avgHeartrate: null,
    coastingPct: null,
  };
}

function ride(overrides: Partial<HistoryActivity> = {}): HistoryActivity {
  return {
    id: "r1",
    name: "Morning ride",
    sportType: "Ride",
    startDate: "2026-10-10T08:00:00Z",
    movingSec: 3600,
    elapsedSec: 3780,
    distanceM: 30_000,
    gainM: 300,
    bands: [band(2, 2400, 32), band(4, 1200, 14)],
    ctl: 60,
    ...overrides,
  };
}

function input(overrides: Partial<PredictionInput>): PredictionInput {
  return {
    profile: profile(30_000, () => 100),
    sportType: "Ride",
    history: [],
    now,
    form: { ctl: null, tsb: null },
    bodyWeightKg: 72,
    ...overrides,
  };
}

describe("parseGpx", () => {
  it("reads track points with elevation and the route name", () => {
    const parsed = parseGpx(gpx(100, () => 250));

    expect(parsed.name).toBe("Test route");
    expect(parsed.points).toHaveLength(5);
    expect(parsed.points[0]?.ele).toBe(250);
  });

  it("falls back to route points", () => {
    expect(parseGpx(gpx(100, null, "rtept")).points).toHaveLength(5);
  });

  it("rejects files that are not GPX or have no points", () => {
    expect(() => parseGpx("<kml></kml>")).toThrow(GpxError);
    expect(() => parseGpx("<gpx><trk></trk></gpx>")).toThrow(GpxError);
  });
});

describe("buildRouteProfile", () => {
  it("measures distance and climbing", () => {
    const route = profile(30_000, hillyEle);

    expect(route.distanceM).toBeGreaterThan(29_900);
    expect(route.distanceM).toBeLessThan(30_100);
    expect(route.gainM).toBeGreaterThan(290);
    expect(route.gainM).toBeLessThan(310);
    expect(route.steps[250]?.gradePct).toBeCloseTo(6, 0);
  });

  it("drops GPS jitter on a flat route", () => {
    const route = profile(10_000, (d) => 100 + Math.sin(d / 7) * 2);

    expect(route.gainM).toBeLessThan(15);
  });

  it("treats a route without elevation as flat", () => {
    const route = profile(5000, null);

    expect(route.hasElevation).toBe(false);
    expect(route.gainM).toBe(0);
    expect(predictRoute(input({ profile: route })).basis.warnings[0]).toMatch(/no elevation/);
  });
});

describe("predictRoute", () => {
  it("uses typical speeds and says so when there is no history", () => {
    const prediction = predictRoute(input({}));

    expect(prediction.movingSec / 60).toBeCloseTo((30 / 27) * 60, -1);
    expect(prediction.basis.confidence).toBe("low");
    expect(prediction.basis.warnings.join(" ")).toMatch(/No recent activities/);
  });

  it("rides the athlete's own flat speed", () => {
    const prediction = predictRoute(input({ history: [ride()] }));
    const flatKmh = 30 / (prediction.movingSec / 3600);

    expect(prediction.basis.flatKmh).toBeCloseTo(32, 0);
    expect(flatKmh).toBeGreaterThan(29);
    expect(flatKmh).toBeLessThan(35);
    expect(prediction.elapsedSec).toBeGreaterThan(prediction.movingSec);
  });

  it("takes longer over a climb and finds it with its predicted start", () => {
    const flat = predictRoute(input({ history: [ride()] }));
    const hilly = predictRoute(input({ history: [ride()], profile: profile(30_000, hillyEle) }));

    expect(hilly.movingSec).toBeGreaterThan(flat.movingSec * 1.1);
    expect(hilly.climbs).toHaveLength(1);
    const climb = hilly.climbs[0];
    expect(climb?.startKm).toBeGreaterThan(9.5);
    expect(climb?.startKm).toBeLessThan(10.5);
    expect(climb?.gainM).toBeGreaterThan(250);
    // 10 flat km at about 32 km/h, plus stops.
    expect((climb?.startSec ?? 0) / 60).toBeGreaterThan(17);
    expect((climb?.startSec ?? 0) / 60).toBeLessThan(23);
  });

  it("slows the end of a route longer than anything comparable", () => {
    const history = [ride({ distanceM: 70_000, movingSec: 7800, elapsedSec: 8000 })];
    const route = profile(90_000, () => 100);
    const prediction = predictRoute(input({ history, profile: route }));
    const lastSplit = prediction.splits.at(-1);
    const firstSplit = prediction.splits[0];

    expect(prediction.basis.beyondExperience).toBe(true);
    expect(lastSplit?.speedKmh).toBeLessThan(firstSplit?.speedKmh ?? 0);
  });

  it("nudges speed with form, within its cap", () => {
    const fresh = predictRoute(input({ history: [ride()], form: { ctl: 60, tsb: 100 } }));
    const tired = predictRoute(input({ history: [ride()], form: { ctl: 60, tsb: -100 } }));

    expect(fresh.basis.formPct).toBe(3);
    expect(tired.basis.formPct).toBe(-3);
    expect(tired.movingSec / fresh.movingSec).toBeLessThan(1.07);
  });

  it("splits rides every 5 km and runs every kilometre", () => {
    const rideSplits = predictRoute(input({})).splits;
    const runSplits = predictRoute(
      input({ sportType: "Run", profile: profile(5000, () => 0) }),
    ).splits;

    expect(rideSplits).toHaveLength(6);
    expect(runSplits).toHaveLength(5);
  });

  it("does not plan swims", () => {
    expect(() => predictRoute(input({ sportType: "Swim" }))).toThrow();
  });
});

describe("rankSimilarActivities", () => {
  it("keeps comparable activities in the same sport group, best first", () => {
    const route = { distanceM: 30_000, gainM: 300 };
    const ranked = rankSimilarActivities(
      route,
      "Ride",
      [
        ride({ id: "close" }),
        ride({ id: "older", startDate: "2026-02-01T08:00:00Z" }),
        ride({ id: "far", distanceM: 60_000 }),
        ride({ id: "flat", gainM: 0 }),
        ride({ id: "run", sportType: "Run" }),
        ride({ id: "gravel", sportType: "GravelRide", distanceM: 31_000 }),
      ],
      now,
    );

    expect(ranked.map((item) => item.id)).toEqual(["close", "gravel", "older"]);
  });
});
