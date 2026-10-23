import { describe, expect, test } from "vite-plus/test";

import { emptyHistogram, formatZoneBpm, zonesFromHistogram } from "./heart-rate.ts";

function ranges(zones: ReturnType<typeof zonesFromHistogram>) {
  return zones.map((zone, index) => formatZoneBpm(zone, index === zones.length - 1));
}

describe("zone methods", () => {
  test("cuts running zones as Friel % of LTHR by default", () => {
    const zones = zonesFromHistogram(emptyHistogram(), "Run", { maxHr: 196, lthr: 172 });
    expect(ranges(zones)).toEqual([
      "≤144 bpm",
      "145–153 bpm",
      "154–162 bpm",
      "163–170 bpm",
      "171+ bpm",
    ]);
  });

  test("cuts % of max heart rate", () => {
    const zones = zonesFromHistogram(emptyHistogram(), "Run", {
      maxHr: 196,
      lthr: 172,
      method: "max",
    });
    expect(ranges(zones)).toEqual([
      "≤118 bpm",
      "119–137 bpm",
      "138–157 bpm",
      "158–176 bpm",
      "177+ bpm",
    ]);
  });

  test("cuts heart-rate reserve between resting and max heart rate", () => {
    const zones = zonesFromHistogram(emptyHistogram(), "Run", {
      maxHr: 196,
      lthr: 172,
      restHr: 50,
      method: "reserve",
    });
    expect(ranges(zones)).toEqual([
      "≤138 bpm",
      "139–152 bpm",
      "153–167 bpm",
      "168–181 bpm",
      "182+ bpm",
    ]);
  });

  test("uses custom boundaries as the tops of zones 1 to 4", () => {
    const histogram = emptyHistogram();
    histogram[150] = 60;
    histogram[180] = 30;
    const zones = zonesFromHistogram(histogram, "Run", {
      maxHr: 196,
      lthr: 172,
      method: "custom",
      customZones: [140, 155, 165, 175],
    });
    expect(ranges(zones)).toEqual([
      "≤140 bpm",
      "141–155 bpm",
      "156–165 bpm",
      "166–175 bpm",
      "176+ bpm",
    ]);
    expect(zones.map((zone) => zone.seconds)).toEqual([0, 60, 0, 0, 30]);
  });

  test("shows no bounds when the method's anchor is missing", () => {
    const reserve = zonesFromHistogram(emptyHistogram(), "Run", {
      maxHr: null,
      lthr: null,
      restHr: 50,
      method: "reserve",
    });
    const lthr = zonesFromHistogram(emptyHistogram(), "Run", { maxHr: 196, lthr: null });
    expect(reserve.every((zone) => zone.minBpm == null)).toBe(true);
    expect(lthr.every((zone) => zone.minBpm == null)).toBe(true);
  });

  test("keeps walking on % of max heart rate whatever method is passed", () => {
    const zones = zonesFromHistogram(emptyHistogram(), "Walk", {
      maxHr: 150,
      lthr: null,
      restHr: 50,
      method: "reserve",
    });
    expect(ranges(zones)[0]).toBe("≤90 bpm");
  });
});
