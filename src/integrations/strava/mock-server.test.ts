import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  process.env.STRAVA_MOCK = "1";
  process.env.APP_ENV = "development";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.DATABASE_URL ??= "postgresql://vo:vo@localhost:5432/vo";
  process.env.BETTER_AUTH_SECRET ??= "test-secret";
});

import { StravaApi } from "./client.ts";
import { MOCK_STRAVA_PATH, handleMockStravaRequest } from "./mock-server.ts";

const APP_URL = "http://localhost:3000";
const MOCK_URL = `${APP_URL}${MOCK_STRAVA_PATH}`;

function mockRequest(path: string, init?: RequestInit) {
  return handleMockStravaRequest(new Request(`${MOCK_URL}${path}`, init));
}

beforeEach(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(MOCK_URL)) {
      throw new Error(`Unexpected network call to ${request.url}`);
    }
    return handleMockStravaRequest(request);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type MockTokens = { access_token: string; refresh_token: string; athlete: { id: number } };

async function requestTokens(params: Record<string, string>) {
  return mockRequest("/oauth/token", { method: "POST", body: new URLSearchParams(params) });
}

async function signIn() {
  return (await (
    await requestTokens({ grant_type: "authorization_code", code: "mock" })
  ).json()) as MockTokens;
}

async function athleteStatus(accessToken: string) {
  return (
    await mockRequest("/api/v3/athlete", { headers: { Authorization: `Bearer ${accessToken}` } })
  ).status;
}

describe("mock Strava OAuth", () => {
  it("authorize redirects straight back to the callback with a code and the same state", async () => {
    const callback = `${APP_URL}/api/auth/callback/strava`;
    const response = await mockRequest(
      `/oauth/authorize?redirect_uri=${encodeURIComponent(callback)}&state=abc&response_type=code`,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(callback);
    expect(location.searchParams.get("state")).toBe("abc");
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("token exchange returns an access token for the mock athlete", async () => {
    const body = await signIn();

    expect(await athleteStatus(body.access_token)).toBe(200);
    expect(body.athlete.id).toBe(1);
  });

  it("rejects an expired access token until the refresh token issues a new one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const tokens = await signIn();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    expect(await athleteStatus(tokens.access_token)).toBe(401);
    const refreshed = (await (
      await requestTokens({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })
    ).json()) as MockTokens;
    expect(await athleteStatus(refreshed.access_token)).toBe(200);
  });

  it("deauthorize revokes every token issued so far, and a new sign-in works again", async () => {
    const other = await signIn();
    const tokens = await signIn();

    expect(await new StravaApi(tokens.access_token).deauthorize()).toEqual({
      access_token: tokens.access_token,
    });
    expect(await athleteStatus(other.access_token)).toBe(401);
    const refresh = await requestTokens({
      grant_type: "refresh_token",
      refresh_token: other.refresh_token,
    });
    expect(refresh.status).toBe(400);
    expect(await athleteStatus((await signIn()).access_token)).toBe(200);
  });
});

describe("StravaApi against mock Strava", () => {
  let accessToken = "";
  beforeEach(async () => {
    accessToken = (await signIn()).access_token;
  });

  it("pages about eight weeks of Ride and Run activities, newest first", async () => {
    const api = new StravaApi(accessToken);
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
    const api = new StravaApi(accessToken);
    const [newest] = await api.listAthleteActivities({ page: 1, perPage: 1 });
    const newestSec = Math.floor(Date.parse(newest?.start_date ?? "") / 1000);

    expect(await api.listAthleteActivities({ after: newestSec })).toEqual([]);
    expect(await api.listAthleteActivities({ after: newestSec - 1 })).toHaveLength(1);
  });

  it("serves GPS, power and heart-rate streams for an outdoor ride, and no power for a run", async () => {
    const api = new StravaApi(accessToken);
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
    expect(await new StravaApi(accessToken).getActivityStreams(42)).toEqual({});
  });
});
