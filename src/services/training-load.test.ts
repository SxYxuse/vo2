import { describe, expect, it } from "vite-plus/test";

import { activityTrainingLoad, buildPmc, type LoadInputs } from "./training-load.ts";

function activity(overrides: Partial<LoadInputs> & Pick<LoadInputs, "sportType">): LoadInputs {
  return {
    movingTime: 3600,
    averageHeartrate: null,
    maxHeartrate: null,
    averageWatts: null,
    weightedAverageWatts: null,
    deviceWatts: false,
    ...overrides,
  };
}

const cyclingWithPowerAndHr: LoadInputs = activity({
  sportType: "Ride",
  deviceWatts: true,
  averageWatts: 200,
  weightedAverageWatts: 210,
  averageHeartrate: 150,
});

describe("activityTrainingLoad", () => {
  it("cycling Activity with device watts and FTP uses power for training load", () => {
    const result = activityTrainingLoad(cyclingWithPowerAndHr, 250, 165);
    expect(result.source).toBe("power");
    expect(result.load).toBeGreaterThan(0);
  });

  it("cycling Activity without device watts or FTP uses heart-rate training load when LTHR is present", () => {
    const withoutDeviceWatts = activityTrainingLoad(
      { ...cyclingWithPowerAndHr, deviceWatts: false },
      250,
      165,
    );
    expect(withoutDeviceWatts.source).toBe("heartRate");
    expect(withoutDeviceWatts.source).not.toBe("power");

    const withoutFtp = activityTrainingLoad(cyclingWithPowerAndHr, null, 165);
    expect(withoutFtp.source).toBe("heartRate");
    expect(withoutFtp.source).not.toBe("power");
  });

  it("run Activity never uses the cycling power path for training load", () => {
    const runWithPowerMeter = activity({
      sportType: "Run",
      deviceWatts: true,
      averageWatts: 280,
      weightedAverageWatts: 280,
      averageHeartrate: 160,
    });

    expect(activityTrainingLoad(runWithPowerMeter, 250, 170).source).toBe("heartRate");
    expect(
      activityTrainingLoad({ ...runWithPowerMeter, averageHeartrate: null }, 250, null).source,
    ).toBe("duration");
  });

  it("Activity with zero moving time has training load 0", () => {
    const result = activityTrainingLoad(
      activity({
        sportType: "Ride",
        movingTime: 0,
        deviceWatts: true,
        averageWatts: 200,
        averageHeartrate: 150,
      }),
      250,
      165,
    );
    expect(result.load).toBe(0);
  });
});

describe("buildPmc", () => {
  it("Form is Fitness minus Fatigue after a training-load day", () => {
    const start = new Date();
    start.setUTCHours(12, 0, 0, 0);
    const points = buildPmc(
      [{ start: start.toISOString(), load: 80, estimatedLoad: 0, movingTime: 3600 }],
      "UTC",
    );
    const today = points[points.length - 1];
    expect(today.load).toBe(80);
    expect(today.tsb).toBe(today.ctl - today.atl);
    expect(today.atl).toBeGreaterThan(today.ctl);
    expect(today.tsb).toBeLessThan(0);
  });
});
