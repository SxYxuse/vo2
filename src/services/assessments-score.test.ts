import { describe, expect, it, vi } from "vite-plus/test";

import { scoreBeepTest, scoreFtp20, scoreRunLthr } from "./assessments-score.ts";

function stream(parts: Array<{ seconds: number; watts?: number; hr: number }>) {
  const time: number[] = [];
  const watts: number[] = [];
  const heartrate: number[] = [];
  let t = 0;
  for (const part of parts) {
    for (let i = 0; i < part.seconds; i += 1) {
      time.push(t);
      watts.push(part.watts ?? 0);
      heartrate.push(part.hr);
      t += 1;
    }
  }
  return { time, watts, heartrate };
}

describe("field test scoring", () => {
  it("scoreFtp20 sets FTP from the best 20-min mean watts and cycling LTHR from that window", () => {
    const { time, watts, heartrate } = stream([
      { seconds: 10 * 60, watts: 120, hr: 120 },
      { seconds: 20 * 60, watts: 200, hr: 165 },
      { seconds: 5 * 60, watts: 80, hr: 188 },
    ]);

    const result = scoreFtp20({ time, watts, heartrate });
    expect(result.meanPower20Min).toBe(200);
    expect(result.ftpWatts).toBe(190);
    expect(result.cyclingLthr).toBe(165);
    expect(result.peakHr).toBe(188);
  });

  it("scoreRunLthr uses the last 20 minutes of the best 30-min heart-rate window, not peak heart rate", () => {
    const { time, heartrate } = stream([
      { seconds: 10 * 60, hr: 140 },
      { seconds: 10 * 60, hr: 175 },
      { seconds: 20 * 60, hr: 168 },
    ]);
    heartrate[10 * 60] = 198;
    heartrate[10 * 60 + 1] = 198;

    const result = scoreRunLthr({ time, heartrate });
    expect(result.runLthr).toBe(168);
    expect(result.peakHr).toBe(198);
  });

  it("scoreBeepTest yields no vo2max without a valid last stage and otherwise returns the protocol functions", () => {
    const stageSpeed = vi.fn(() => 13.5);
    const vo2max = vi.fn(() => 52.4);

    const missing = scoreBeepTest({
      time: null,
      heartrate: null,
      lastStage: null,
      age: 34,
      vo2max,
      stageSpeed,
    });
    expect(missing.vo2max).toBeNull();
    expect(missing.lastStage).toBeNull();

    const invalid = scoreBeepTest({
      time: null,
      heartrate: null,
      lastStage: 0,
      age: 34,
      vo2max,
      stageSpeed,
    });
    expect(invalid.vo2max).toBeNull();
    expect(stageSpeed).not.toHaveBeenCalled();
    expect(vo2max).not.toHaveBeenCalled();

    const scored = scoreBeepTest({
      time: null,
      heartrate: null,
      lastStage: 11,
      age: 34,
      vo2max,
      stageSpeed,
    });
    expect(stageSpeed).toHaveBeenCalledWith(11);
    expect(vo2max).toHaveBeenCalledWith(13.5, 34);
    expect(scored.lastStage).toBe(11);
    expect(scored.lastStageSpeedKmh).toBe(13.5);
    expect(scored.vo2max).toBe(52.4);
  });
});
