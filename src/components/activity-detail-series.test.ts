import { describe, expect, it } from "vite-plus/test";

import { streamAxisPlacement, streamYAxis } from "./activity-detail-series.ts";

describe("streamYAxis", () => {
  it("writes running pace ticks as m:ss and inverts the scale", () => {
    const axis = streamYAxis("speed", "Run");
    expect(axis.reversed).toBe(true);
    expect(axis.domain).toEqual(["auto", "auto"]);
    expect(axis.formatTick(300)).toBe("5:00");
    expect(axis.formatTick(267)).toBe("4:27");
  });

  it("writes swim pace ticks as m:ss on an inverted auto domain", () => {
    const axis = streamYAxis("speed", "Swim");
    expect(axis.reversed).toBe(true);
    expect(axis.formatTick(90)).toBe("1:30");
  });

  it("keeps cycling speed as rounded km/h from 0", () => {
    const axis = streamYAxis("speed", "Ride");
    expect(axis.reversed).toBe(false);
    expect(axis.domain).toEqual([0, "auto"]);
    expect(axis.formatTick(32.2)).toBe("32");
  });

  it("fits elevation to the samples instead of forcing sea level", () => {
    const axis = streamYAxis("altitude", "Ride");
    expect(axis.reversed).toBe(false);
    expect(axis.domain).toEqual(["auto", "auto"]);
    expect(axis.formatTick(1847.4)).toBe("1847");
  });

  it("rounds heart rate, power, and cadence to whole units from 0", () => {
    expect(streamYAxis("heartrate", "Run").formatTick(142.6)).toBe("143");
    expect(streamYAxis("watts", "Ride").domain).toEqual([0, "auto"]);
    expect(streamYAxis("cadence", "Ride").formatTick(88.4)).toBe("88");
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
