import { describe, expect, it } from "vite-plus/test";

import {
  chartLocomotionValue,
  defaultVisibleSeries,
  formatLocomotion,
  locomotionFor,
  normalizeSeriesPoint,
  showsPaceByDefault,
} from "./locomotion.ts";

describe("locomotionFor", () => {
  it("uses min/km pace for running and walking sport types", () => {
    expect(locomotionFor("Run")).toMatchObject({ kind: "pace", unit: "/km", kpiLabel: "Avg pace" });
    expect(locomotionFor("TrailRun").unit).toBe("/km");
    expect(locomotionFor("VirtualRun").unit).toBe("/km");
    expect(locomotionFor("Walk").unit).toBe("/km");
    expect(locomotionFor("Hike").unit).toBe("/km");
  });

  it("uses min/100m pace for pool and open-water swims", () => {
    expect(locomotionFor("Swim")).toMatchObject({ kind: "pace", unit: "/100m" });
    expect(locomotionFor("OpenWaterSwim").unit).toBe("/100m");
  });

  it("keeps km/h speed for cycling and ungrouped sports", () => {
    expect(locomotionFor("Ride")).toMatchObject({ kind: "speed", unit: "km/h", kpiLabel: "Avg speed" });
    expect(locomotionFor("VirtualRide").kind).toBe("speed");
    expect(locomotionFor("EBikeRide").kind).toBe("speed");
    expect(locomotionFor("AlpineSki").kind).toBe("speed");
    expect(locomotionFor("Rowing").kind).toBe("speed");
  });
});

describe("formatLocomotion", () => {
  it("writes running pace as m:ss /km from the existing average speed", () => {
    expect(formatLocomotion(12, "Run")).toBe("5:00 /km");
    expect(formatLocomotion(15, "TrailRun")).toBe("4:00 /km");
    expect(formatLocomotion(10, "Walk")).toBe("6:00 /km");
    expect(formatLocomotion(13.5, "Run")).toBe("4:27 /km");
  });

  it("writes swim pace as m:ss /100m", () => {
    expect(formatLocomotion(4, "Swim")).toBe("1:30 /100m");
    expect(formatLocomotion(3.6, "OpenWaterSwim")).toBe("1:40 /100m");
  });

  it("keeps cycling speed as 0.1 km/h precision", () => {
    expect(formatLocomotion(28.4, "Ride")).toBe("28.4 km/h");
    expect(formatLocomotion(0, "Ride")).toBe("0.0 km/h");
  });

  it("treats a stopped pace sample as missing", () => {
    expect(formatLocomotion(0, "Run")).toBe("—");
    expect(formatLocomotion(null, "Swim")).toBe("—");
    expect(formatLocomotion(null, "Ride")).toBe("—");
  });
});

describe("chartLocomotionValue", () => {
  it("gaps non-positive pace samples and leaves cycling speed as km/h", () => {
    expect(chartLocomotionValue(12, "Run")).toBe(300);
    expect(chartLocomotionValue(0, "Run")).toBeUndefined();
    expect(chartLocomotionValue(undefined, "Walk")).toBeUndefined();
    expect(chartLocomotionValue(0, "Ride")).toBe(0);
    expect(chartLocomotionValue(32.2, "Ride")).toBe(32.2);
  });
});

describe("normalizeSeriesPoint", () => {
  it("puts a faster pace sample higher on a combined chart than a slower one", () => {
    const fast = normalizeSeriesPoint(240, 240, 330, true);
    const slow = normalizeSeriesPoint(330, 240, 330, true);
    expect(fast).toBe(100);
    expect(slow).toBe(0);
  });

  it("keeps faster speed higher without inverting", () => {
    expect(normalizeSeriesPoint(40, 20, 40, false)).toBe(100);
    expect(normalizeSeriesPoint(20, 20, 40, false)).toBe(0);
  });
});

describe("defaultVisibleSeries", () => {
  const series = ["heartrate", "watts", "cadence", "speed", "altitude"] as const;

  it("shows pace by default on run, walk, and swim", () => {
    expect(showsPaceByDefault("Run")).toBe(true);
    expect(defaultVisibleSeries({ sportType: "Run", series: [...series] })).toEqual([
      "heartrate",
      "speed",
      "altitude",
    ]);
    expect(defaultVisibleSeries({ sportType: "Hike", series: [...series] })).toContain("speed");
    expect(defaultVisibleSeries({ sportType: "Swim", series: [...series] })).toContain("speed");
  });

  it("hides speed by default on rides", () => {
    expect(defaultVisibleSeries({ sportType: "Ride", series: [...series] })).toEqual([
      "heartrate",
      "watts",
      "altitude",
    ]);
  });
});
