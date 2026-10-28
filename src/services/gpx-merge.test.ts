import { describe, expect, it } from "vite-plus/test";

import {
  buildMergedRoute,
  findJunctions,
  makeTrack,
  parseGpx,
  sliceTrack,
  suggestLegs,
  switchAtJunction,
  toGpx,
  trackLength,
  type GpxPoint,
} from "./gpx-merge.ts";

const ORIGIN = { lat: 50, lng: 4 };
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A point `x` metres east and `y` metres north of the origin. */
function at(x: number, y: number, ele: number | null = null): GpxPoint {
  return { lng: ORIGIN.lng + x / M_PER_DEG_LNG, lat: ORIGIN.lat + y / M_PER_DEG_LAT, ele };
}

function track(id: string, ...points: GpxPoint[]) {
  return makeTrack(id, id, points);
}

let ids = 0;
const newId = () => `leg-${(ids += 1)}`;

describe("parseGpx", () => {
  it("reads track points, elevation, and the name", () => {
    const parsed = parseGpx(
      `<?xml version="1.0"?>
      <gpx version="1.1"><metadata><name>Col &amp; Lac</name></metadata>
        <trk><trkseg>
          <trkpt lat="50.0" lon="4.0"><ele>100</ele></trkpt>
          <trkpt lon='4.001' lat='50.001'><ele>110.5</ele><time>2024-01-01T00:00:00Z</time></trkpt>
        </trkseg><trkseg>
          <trkpt lat="50.002" lon="4.002"/>
        </trkseg></trk>
      </gpx>`,
      "a",
      "fallback",
    );
    expect(parsed.name).toBe("Col & Lac");
    expect(parsed.points).toEqual([
      { lat: 50, lng: 4, ele: 100 },
      { lat: 50.001, lng: 4.001, ele: 110.5 },
      { lat: 50.002, lng: 4.002, ele: null },
    ]);
    expect(trackLength(parsed)).toBeGreaterThan(200);
  });

  it("falls back to route points and the file name", () => {
    const parsed = parseGpx(
      `<gpx><rte><rtept lat="50" lon="4"/><rtept lat="50.01" lon="4"/></rte></gpx>`,
      "a",
      "morning-loop",
    );
    expect(parsed.name).toBe("morning-loop");
    expect(parsed.points).toHaveLength(2);
  });

  it("rejects files with no track", () => {
    expect(() => parseGpx("<html></html>", "a", "x")).toThrow("not a GPX");
    expect(() => parseGpx(`<gpx><trk><trkpt lat="50" lon="4"/></trk></gpx>`, "a", "x")).toThrow(
      "no track",
    );
  });
});

describe("sliceTrack", () => {
  const line = track("a", at(0, 0, 0), at(1000, 0, 100), at(2000, 0, 0));

  it("interpolates the ends", () => {
    const slice = sliceTrack(line, 500, 1500);
    expect(slice).toHaveLength(3);
    expect(slice[0]!.ele).toBeCloseTo(50);
    expect(slice[1]).toEqual(line.points[1]);
    expect(slice[2]!.ele).toBeCloseTo(50);
  });

  it("runs backward when the end comes before the start", () => {
    const slice = sliceTrack(line, trackLength(line), 0);
    expect(slice.map((point) => point.ele)).toEqual([0, 100, 0]);
    expect(slice[0]!.lng).toBeCloseTo(line.points[2]!.lng);
  });
});

describe("findJunctions", () => {
  it("finds a crossing between two sparse lines", () => {
    const a = track("a", at(0, 0), at(2000, 0));
    const b = track("b", at(1000, -1000), at(1000, 1000));
    const junctions = findJunctions(a, b, 20);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]!.kind).toBe("cross");
    expect(junctions[0]!.a.m).toBeCloseTo(1000, -1);
    expect(junctions[0]!.b.m).toBeCloseTo(1000, -1);
  });

  it("gives a shared stretch a join and a split", () => {
    const a = track("a", at(0, 0), at(3000, 0));
    // Arrives from the south, follows A 8 m off to the side, and leaves north.
    const b = track("b", at(1000, -1000), at(1000, 8), at(2000, 8), at(2000, 1000));
    const junctions = findJunctions(a, b, 20);
    expect(junctions.map((junction) => junction.kind)).toEqual(["join", "split"]);
    expect(junctions[0]!.a.m).toBeGreaterThan(970);
    expect(junctions[0]!.a.m).toBeLessThan(1030);
    expect(junctions[1]!.a.m).toBeGreaterThan(1970);
    expect(junctions[1]!.a.m).toBeLessThan(2030);
    expect(junctions[1]!.b.m).toBeCloseTo(2000, -2);
  });

  it("finds nothing when the tracks stay apart", () => {
    const a = track("a", at(0, 0), at(2000, 0));
    const b = track("b", at(0, 100), at(2000, 100));
    expect(findJunctions(a, b, 50)).toEqual([]);
    expect(findJunctions(a, b, 150)).toHaveLength(2);
  });
});

describe("buildMergedRoute", () => {
  const a = track("a", at(0, 0, 25), at(2000, 0, 25));
  const b = track("b", at(1000, -1000, 0), at(1000, 1000, 50));

  it("starts a linked leg where the previous one ends", () => {
    const route = buildMergedRoute(
      [a, b],
      [
        { id: "1", trackId: "a", fromM: 0, toM: 1000, linked: false },
        { id: "2", trackId: "b", fromM: 0, toM: trackLength(b), linked: true },
      ],
    );
    expect(route.legs[1]!.fromM).toBeCloseTo(1000, -1);
    expect(route.legs[1]!.gapM).toBeLessThan(1);
    expect(route.distanceM).toBeCloseTo(2000, -1);
    expect(route.gainM).toBeCloseTo(25, 0);
  });

  it("keeps a linked leg on the pass it switched at", () => {
    // Out along y = 0 and back along y = 6: both passes go by x = 1000.
    const outAndBack = track("c", at(0, 0), at(2000, 0), at(2000, 6), at(0, 6));
    const legs = [
      { id: "1", trackId: "b", fromM: 0, toM: 1000, linked: false },
      { id: "2", trackId: "c", fromM: 3000, toM: trackLength(outAndBack), linked: true },
    ];
    const route = buildMergedRoute([b, outAndBack], legs);
    expect(route.legs[1]!.fromM).toBeCloseTo(3006, -1);
    expect(route.legs[1]!.distanceM).toBeCloseTo(1000, -1);
  });

  it("reports the jump between legs that do not meet", () => {
    const route = buildMergedRoute(
      [a, b],
      [
        { id: "1", trackId: "a", fromM: 0, toM: 500, linked: false },
        { id: "2", trackId: "b", fromM: 1000, toM: 2000, linked: false },
      ],
    );
    expect(route.legs[1]!.gapM).toBeCloseTo(500, -1);
  });
});

describe("suggestLegs", () => {
  it("switches to the next track at their first junction", () => {
    const a = track("a", at(0, 0), at(2000, 0));
    const b = track("b", at(1000, -1000), at(1000, 1000));
    const legs = suggestLegs([a, b], findJunctions(a, b, 20), newId);
    expect(legs).toHaveLength(2);
    expect(legs[0]!.toM).toBeCloseTo(1000, -1);
    expect(legs[1]).toMatchObject({ trackId: "b", linked: true, toM: trackLength(b) });
  });

  it("jumps to the next track when they never meet", () => {
    const a = track("a", at(0, 0), at(2000, 0));
    const b = track("b", at(0, 500), at(2000, 500));
    const legs = suggestLegs([a, b], [], newId);
    expect(legs[0]!.toM).toBe(trackLength(a));
    expect(legs[1]).toMatchObject({ trackId: "b", linked: false, fromM: 0 });
  });
});

describe("switchAtJunction", () => {
  const a = track("a", at(0, 0), at(3000, 0));
  const b = track("b", at(1000, -1000), at(1000, 1000));
  const c = track("c", at(2000, -1000), at(2000, 1000));
  const junctions = [...findJunctions(a, b, 20), ...findJunctions(a, c, 20)];
  const whole = [{ id: "1", trackId: "a", fromM: 0, toM: trackLength(a), linked: false }];

  it("ends the leg at the junction and carries on along the other track", () => {
    const route = buildMergedRoute([a, b, c], whole);
    const legs = switchAtJunction(route, [a, b, c], junctions[1]!, newId);
    expect(legs).toHaveLength(2);
    expect(legs![0]!.toM).toBeCloseTo(2000, -1);
    expect(legs![1]).toMatchObject({ trackId: "c", linked: true, toM: trackLength(c) });
  });

  it("links the next leg when it is already on the other track", () => {
    const route = buildMergedRoute(
      [a, b],
      [...whole, { id: "2", trackId: "b", fromM: 0, toM: 500, linked: false }],
    );
    const legs = switchAtJunction(route, [a, b], junctions[0]!, newId);
    expect(legs!.map((leg) => leg.id)).toEqual(["1", "2"]);
    expect(legs![1]).toMatchObject({ linked: true, toM: 500 });
  });

  it("does nothing for a junction no leg passes", () => {
    const route = buildMergedRoute(
      [a, b],
      [{ id: "1", trackId: "a", fromM: 0, toM: 500, linked: false }],
    );
    expect(switchAtJunction(route, [a, b], junctions[0]!, newId)).toBeNull();
  });
});

describe("toGpx", () => {
  it("writes a file parseGpx reads back", () => {
    const points = [at(0, 0, 12.3), at(500, 0, null)];
    const parsed = parseGpx(toGpx("A <B>", points), "x", "fallback");
    expect(parsed.name).toBe("A <B>");
    expect(parsed.points[0]!.ele).toBe(12.3);
    expect(parsed.points[1]!.ele).toBeNull();
    expect(parsed.points[1]!.lng).toBeCloseTo(points[1]!.lng, 6);
  });
});
