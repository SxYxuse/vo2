import { describe, expect, it } from "vite-plus/test";

import { activityMapTrace } from "./activity-map.types.ts";

// Worked example from Google's encoded polyline algorithm documentation.
const GOOGLE_EXAMPLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

describe("activityMapTrace", () => {
  it("starts and finishes where the outline does", () => {
    const trace = activityMapTrace(GOOGLE_EXAMPLE);
    expect(trace?.start).toEqual([-120.2, 38.5]);
    expect(trace?.finish).toEqual([-126.453, 43.252]);
    expect(trace?.coordinates).toHaveLength(3);
  });

  it("has no map for an activity without an outline", () => {
    expect(activityMapTrace(null)).toBeNull();
    // Strava sends an empty outline for indoor sessions.
    expect(activityMapTrace("")).toBeNull();
  });

  it("has no map when the outline is a single point", () => {
    expect(activityMapTrace("_p~iF~ps|U")).toBeNull();
  });
});
