import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_HEART_RATE_SETTINGS,
  heartRateSettingsIssues,
  parseHeartRateSettings,
  ZONE_METHOD_ANCHORS,
  type HeartRateEstimates,
  type HeartRateSettings,
} from "./heart-rate-settings.ts";
import {
  emptyHistogram,
  resolveHeartRate,
  zonesFromHistogram,
  type ZoneMethod,
} from "./heart-rate.ts";

const ESTIMATES: HeartRateEstimates = {
  restHr: 52,
  maxHr: { cycling: 188, running: 196, swimming: 170 },
};
const RUNNING = { restHr: 52, maxHr: 196 };

function withRunning(
  running: Partial<HeartRateSettings["sports"]["running"]>,
  restHr: number | null = null,
) {
  return {
    restHr,
    sports: {
      ...DEFAULT_HEART_RATE_SETTINGS.sports,
      running: { ...DEFAULT_HEART_RATE_SETTINGS.sports.running, ...running },
    },
  } satisfies HeartRateSettings;
}

describe("parseHeartRateSettings", () => {
  test("falls back to estimates and % of LTHR for anything missing or invalid", () => {
    expect(parseHeartRateSettings(null)).toEqual(DEFAULT_HEART_RATE_SETTINGS);
    expect(parseHeartRateSettings({ restHr: "fast" })).toEqual(DEFAULT_HEART_RATE_SETTINGS);
    const parsed = parseHeartRateSettings({ sports: { running: { method: "reserve" } } });
    expect(parsed.sports.running.method).toBe("reserve");
    expect(parsed.sports.cycling.method).toBe("lthr");
  });
});

describe("resolveHeartRate", () => {
  test("uses estimates when nothing is set", () => {
    const running = resolveHeartRate("running", DEFAULT_HEART_RATE_SETTINGS, RUNNING);
    expect(running).toMatchObject({
      method: "lthr",
      maxHr: 196,
      maxSource: "estimated",
      lthr: 172,
      lthrSource: "estimated",
      restHr: 52,
      restSource: "estimated",
    });
  });

  test("a set value wins and a blank LTHR is estimated from a set max", () => {
    const running = resolveHeartRate("running", withRunning({ maxHr: 200 }, 48), RUNNING);
    expect(running).toMatchObject({
      maxHr: 200,
      maxSource: "athlete",
      lthr: 176,
      lthrSource: "estimated",
      restHr: 48,
      restSource: "athlete",
    });
    const set = resolveHeartRate("running", withRunning({ lthr: 178 }), RUNNING);
    expect(set).toMatchObject({ lthr: 178, lthrSource: "athlete" });
  });

  test("prefers a stored LTHR estimate over the share of max", () => {
    const running = resolveHeartRate("running", DEFAULT_HEART_RATE_SETTINGS, {
      ...RUNNING,
      lthr: 175,
    });
    expect(running.lthr).toBe(175);
  });

  test("keeps a stored LTHR estimate under a set max, but not one at or above it", () => {
    const estimates = { ...RUNNING, lthr: 175 };
    expect(resolveHeartRate("running", withRunning({ maxHr: 200 }), estimates).lthr).toBe(175);
    // 88 % of a set max of 175.
    expect(resolveHeartRate("running", withRunning({ maxHr: 175 }), estimates).lthr).toBe(154);
  });

  test("has no anchors before any sync", () => {
    const running = resolveHeartRate("running", undefined, { restHr: null, maxHr: null });
    expect(running).toMatchObject({ maxHr: null, maxSource: null, lthr: null, lthrSource: null });
  });
});

describe("heartRateSettingsIssues", () => {
  test("accepts estimates", () => {
    expect(heartRateSettingsIssues(DEFAULT_HEART_RATE_SETTINGS, ESTIMATES)).toEqual([]);
  });

  test("blocks an LTHR at or above max heart rate, estimated or set", () => {
    const issues = heartRateSettingsIssues(withRunning({ lthr: 200 }), ESTIMATES);
    expect(issues).toEqual([
      { path: "sports.running.lthr", message: expect.stringContaining("196") },
    ]);
  });

  test("blocks a resting heart rate at or above any LTHR", () => {
    const issues = heartRateSettingsIssues(withRunning({}, 150), {
      ...ESTIMATES,
      maxHr: { cycling: 188, running: 196, swimming: 160 },
    });
    // Swimming LTHR is 85 % of 160 = 136.
    expect(issues.map((issue) => issue.path)).toEqual(["restHr"]);
  });

  test("blocks custom zones that don't rise", () => {
    const issues = heartRateSettingsIssues(
      withRunning({ method: "custom", customZones: [140, 150, 150, 170] }),
      ESTIMATES,
    );
    expect(issues.map((issue) => issue.path)).toEqual(["sports.running.customZones"]);
  });
});

describe("ZONE_METHOD_ANCHORS", () => {
  const BASE = { rest: 52, lthr: 170, max: 196 };

  function zoneTops(method: ZoneMethod, values: typeof BASE) {
    const settings = withRunning({ method, lthr: values.lthr, maxHr: values.max }, values.rest);
    const resolved = resolveHeartRate("running", settings, RUNNING);
    // The tops of zones 1 to 4; zone 5 has no top.
    return zonesFromHistogram(emptyHistogram(), "Run", resolved)
      .slice(0, 4)
      .map((zone) => zone.maxBpm);
  }

  test.each(["lthr", "max", "reserve"] satisfies ZoneMethod[])(
    "%s zones move with exactly the anchors the settings page marks",
    (method) => {
      for (const anchor of ["rest", "lthr", "max"] as const) {
        const moved = zoneTops(method, { ...BASE, [anchor]: BASE[anchor] - 6 });
        const changed = JSON.stringify(moved) !== JSON.stringify(zoneTops(method, BASE));
        expect({ anchor, changed }).toEqual({
          anchor,
          changed: ZONE_METHOD_ANCHORS[method].includes(anchor),
        });
      }
    },
  );
});
