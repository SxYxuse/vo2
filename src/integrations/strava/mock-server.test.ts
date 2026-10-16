import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { StravaApi } from "./client.ts";
import { MOCK_STRAVA_PATH, handleMockStravaRequest } from "./mock-server.ts";

const APP_URL = "http://localhost:3000";
const MOCK_URL = `${APP_URL}${MOCK_STRAVA_PATH}`;

function mockRequest(path: string, init?: RequestInit) {
  return handleMockStravaRequest(new Request(`${MOCK_URL}${path}`, init));
}

beforeEach(() => {
  vi.stubEnv("STRAVA_MOCK", "1");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("BETTER_AUTH_URL", APP_URL);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(MOCK_URL)) {
      throw new Error(`Unexpected network call to ${request.url}`);
    }
    return Promise.resolve(handleMockStravaRequest(request));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("mock Strava OAuth", () => {
  it("authorize redirects straight back to the callback with a code and the same state", () => {
    const callback = `${APP_URL}/api/auth/callback/strava`;
    const response = mockRequest(
      `/oauth/authorize?redirect_uri=${encodeURIComponent(callback)}&state=abc&response_type=code`,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(callback);
    expect(location.searchParams.get("state")).toBe("abc");
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("token exchange returns an access token for the mock athlete", async () => {
    const response = mockRequest("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: "mock" }),
    });
    const body = (await response.json()) as { access_token: string; athlete: { id: number } };

    expect(body.access_token).toBeTruthy();
    expect(body.athlete.id).toBe(1);
  });

  it("returns 404 for every route when STRAVA_MOCK is off", () => {
    vi.stubEnv("STRAVA_MOCK", "");
    expect(mockRequest("/api/v3/athlete").status).toBe(404);
  });

  it("returns 404 in production even with STRAVA_MOCK set", () => {
    vi.stubEnv("APP_ENV", "production");
    expect(mockRequest("/api/v3/athlete").status).toBe(404);
  });
});

describe("StravaApi against mock Strava", () => {
  it("pages about eight weeks of Ride and Run activities, newest first", async () => {
    const api = new StravaApi("mock-token");
    const firstPage = await api.listAthleteActivities({ page: 1, perPage: 10 });
    const all = await api.listAthleteActivities({ page: 1, perPage: 200 });
    const secondPage = await api.listAthleteActivities({ page: 2, perPage: 10 });
    const sportTypes = new Set(all.map((activity) => activity.sport_type));
    const starts = all.map((activity) => Date.parse(activity.start_date ?? ""));

    expect(firstPage).toHaveLength(10);
    expect(secondPage[0]?.id).toBe(all[10]?.id);
    expect(all.length).toBeGreaterThanOrEqual(24);
    expect(sportTypes.has("Ride")).toBe(true);
    expect(sportTypes.has("Run")).toBe(true);
    expect(starts).toEqual([...starts].sort((left, right) => right - left));
    expect(Date.now() - Math.min(...starts)).toBeLessThanOrEqual(57 * 86_400_000);
  });

  it("honors after so a resync only returns newer activities", async () => {
    const api = new StravaApi("mock-token");
    const [newest] = await api.listAthleteActivities({ page: 1, perPage: 1 });
    const newestSec = Math.floor(Date.parse(newest?.start_date ?? "") / 1000);

    expect(await api.listAthleteActivities({ after: newestSec })).toEqual([]);
    expect(await api.listAthleteActivities({ after: newestSec - 1 })).toHaveLength(1);
  });

  it("serves GPS, power and heart-rate streams for an outdoor ride, and no power for a run", async () => {
    const api = new StravaApi("mock-token");
    const activities = await api.listAthleteActivities();
    const ride = activities.find((activity) => activity.sport_type === "Ride");
    const run = activities.find((activity) => activity.sport_type === "Run");

    expect(ride?.map?.summary_polyline).toBeTruthy();
    expect(ride?.device_watts).toBe(true);

    const rideStreams = await api.getActivityStreams(ride!.id!);
    const runStreams = await api.getActivityStreams(run!.id!);
    expect(rideStreams.latlng?.data?.length).toBeGreaterThan(8);
    expect(rideStreams.watts?.data?.some((watts) => watts > 0)).toBe(true);
    expect(rideStreams.heartrate?.data?.some((bpm) => bpm > 0)).toBe(true);
    expect(runStreams.heartrate?.data?.some((bpm) => bpm > 0)).toBe(true);
    expect(runStreams.watts).toBeUndefined();
  });

  it("returns no streams for an unknown activity", async () => {
    expect(await new StravaApi("mock-token").getActivityStreams(42)).toEqual({});
  });
});
