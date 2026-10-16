import { describe, expect, it } from "vite-plus/test";

import {
  chartPointForStream,
  chartRowsFor,
  streamAxisPlacement,
  streamSeriesValues,
  streamYAxis,
} from "./activity-detail-series.ts";

describe("streamYAxis", () => {
  it("writes running pace ticks as m:ss and inverts the scale", () => {
    const axis = streamYAxis("speed", "Run");
    expect(axis.reversed).toBe(true);
    expect(axis.allowDataOverflow).toBe(true);
    expect(axis.domain).toEqual(["auto", "auto"]);
    expect(axis.formatTick(300)).toBe("5:00");
    expect(axis.formatTick(267)).toBe("4:27");
    expect(axis.formatTick(0)).toBe("");
  });

  it("writes swim pace ticks as m:ss on an inverted auto domain", () => {
    const axis = streamYAxis("speed", "Swim");
    expect(axis.reversed).toBe(true);
    expect(axis.formatTick(90)).toBe("1:30");
  });

  it("caps the slow pace end near the 95th percentile so a 40:00 wander does not own the axis", () => {
    const values = [
      ...Array.from({ length: 95 }, () => 300),
      ...Array.from({ length: 5 }, () => 2400),
    ];
    const axis = streamYAxis("speed", "Run", values);
    expect(Number(axis.domain[0])).toBeGreaterThan(0);
    expect(axis.formatTick(Number(axis.domain[0]))).not.toBe("0:00");
    expect(axis.domain[1]).toBeGreaterThanOrEqual(400);
    expect(Number(axis.domain[1])).toBeLessThan(600);
    expect(axis.ticks?.includes(0)).toBeFalsy();
  });

  it("keeps a trail hike on-scale when slow samples are common", () => {
    const values = [
      ...Array.from({ length: 80 }, () => 360),
      ...Array.from({ length: 20 }, () => 1200),
    ];
    const axis = streamYAxis("speed", "TrailRun", values);
    expect(Number(axis.domain[0])).toBeGreaterThan(0);
    expect(axis.formatTick(Number(axis.domain[0]))).not.toBe("0:00");
    expect(Number(axis.domain[1])).toBeGreaterThan(1200);
    expect(Number(axis.domain[1])).toBeLessThan(1800);
  });

  it("still clips a rare 40:00 wander when 95% of the run is the same pace", () => {
    const values = [
      ...Array.from({ length: 98 }, () => 300),
      ...Array.from({ length: 2 }, () => 2400),
    ];
    const axis = streamYAxis("speed", "Run", values);
    expect(Number(axis.domain[0])).toBeGreaterThan(0);
    expect(axis.formatTick(Number(axis.domain[0]))).not.toBe("0:00");
    expect(Number(axis.domain[1])).toBeGreaterThanOrEqual(300);
    expect(Number(axis.domain[1])).toBeLessThan(600);
  });

  it("gives 800m reps headroom without a 0:00 tick and keeps 10:00 recoveries on-scale", () => {
    const values = [
      ...Array.from({ length: 60 }, () => 275),
      ...Array.from({ length: 40 }, () => 600),
    ];
    const axis = streamYAxis("speed", "Run", values);
    expect(Number(axis.domain[0])).toBeGreaterThan(0);
    expect(Number(axis.domain[0])).toBeLessThan(275);
    expect(axis.formatTick(Number(axis.domain[0]))).not.toBe("0:00");
    expect(Number(axis.domain[1])).toBeGreaterThan(600);
    expect(Number(axis.domain[1])).toBeLessThan(900);
    expect(axis.ticks?.[0]).not.toBe(0);
  });

  it("pads past the 95th percentile so a normal easy-run trace is not glued to the floor", () => {
    const values = Array.from({ length: 100 }, () => 450);
    const axis = streamYAxis("speed", "Run", values);
    expect(Number(axis.domain[1])).toBeGreaterThan(450);
    expect(Number(axis.domain[1])).toBeLessThan(600);
  });

  it("keeps cycling speed as rounded km/h from 0", () => {
    const axis = streamYAxis("speed", "Ride");
    expect(axis.reversed).toBe(false);
    expect(axis.allowDataOverflow).toBe(false);
    expect(axis.domain).toEqual([0, "auto"]);
    expect(axis.formatTick(32.2)).toBe("32");
  });

  it("fits elevation to the samples instead of forcing sea level", () => {
    const axis = streamYAxis("altitude", "Ride");
    expect(axis.reversed).toBe(false);
    expect(axis.domain).toEqual(["auto", "auto"]);
    expect(axis.formatTick(1847.4)).toBe("1847");
  });

  it("fits heart rate to plausible samples instead of starting at 0", () => {
    const axis = streamYAxis("heartrate", "Run");
    expect(axis.domain).toEqual(["auto", "auto"]);
    expect(axis.formatTick(142.6)).toBe("143");
    expect(streamYAxis("watts", "Ride").domain).toEqual([0, "auto"]);
    expect(streamYAxis("cadence", "Ride").formatTick(88.4)).toBe("88");
  });
});

describe("chartPointForStream", () => {
  it("gaps implausible heart rate and GPS crawl pace, keeping a 40:00 hike sample", () => {
    const row = chartPointForStream({ t: 25, heartrate: 0, speed: 0.2, altitude: 667 }, "Run");
    expect(row.heartrate).toBeUndefined();
    expect(row.speed).toBeUndefined();
    expect(row.altitude).toBe(667);

    const hike = chartPointForStream({ t: 80, heartrate: 250, speed: 1.5 }, "TrailRun");
    expect(hike.heartrate).toBeUndefined();
    expect(hike.speed).toBe(2400);

    const live = chartPointForStream({ t: 10, heartrate: 131, speed: 12 }, "Run");
    expect(live.heartrate).toBe(131);
    expect(live.speed).toBe(300);
  });
});

describe("chartRowsFor", () => {
  it("averages moving speed over the last 60 seconds before converting to pace", () => {
    const rows = chartRowsFor(
      [
        { t: 0, speed: 12 },
        { t: 10, speed: 12 },
        { t: 20, speed: 6 },
      ],
      "Run",
    );
    expect(rows[0].speed).toBe(300);
    expect(rows[2].speed).toBe(360);
  });

  it("clips a crawl sample to the slow floor and leaves it out of the next pace average", () => {
    const rows = chartRowsFor(
      [
        { t: 0, speed: 12 },
        { t: 10, speed: 10 },
        { t: 20, speed: 0.2 },
        { t: 30, speed: 12 },
      ],
      "Run",
    );
    expect(rows[2].speed).toBeGreaterThan(rows[3].speed ?? 0);
    expect(rows[2].speed).toBeLessThan(3600);
    expect(rows[3].speed).toBe(318);
  });

  it("drops moving samples older than 60 seconds from the pace average", () => {
    const rows = chartRowsFor(
      [
        { t: 0, speed: 6 },
        { t: 61, speed: 12 },
      ],
      "Run",
    );
    expect(rows[1].speed).toBe(300);
  });

  it("leaves cycling speed unsmoothed", () => {
    const rows = chartRowsFor(
      [
        { t: 0, speed: 30 },
        { t: 10, speed: 10 },
      ],
      "Ride",
    );
    expect(rows[1].speed).toBe(10);
  });
});

describe("streamSeriesValues", () => {
  it("skips gapped pace samples when collecting axis values", () => {
    expect(
      streamSeriesValues([{ t: 0, speed: 300 }, { t: 1 }, { t: 2, speed: 2400 }], "speed"),
    ).toEqual([300, 2400]);
  });
});

describe("streamAxisPlacement", () => {
  it("puts the first series on the left and the second on the right", () => {
    expect(streamAxisPlacement(0)).toEqual({ orientation: "left", hide: false });
    expect(streamAxisPlacement(1)).toEqual({ orientation: "right", hide: false });
  });

  it("keeps extra series scaled but without a third axis", () => {
    expect(streamAxisPlacement(2)).toEqual({ orientation: "left", hide: true });
  });
});
