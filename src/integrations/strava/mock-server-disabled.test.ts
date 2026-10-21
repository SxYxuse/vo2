import { describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  process.env.STRAVA_MOCK = "";
  process.env.APP_ENV = "development";
  process.env.DATABASE_URL ??= "postgresql://vo:vo@localhost:5432/vo";
  process.env.BETTER_AUTH_SECRET ??= "test-secret";
  process.env.STRAVA_CLIENT_ID ??= "test-id";
  process.env.STRAVA_CLIENT_SECRET ??= "test-secret";
});

import { MOCK_STRAVA_PATH, handleMockStravaRequest } from "./mock-server.ts";

describe("mock Strava when disabled", () => {
  it("returns 404 for every route when STRAVA_MOCK is off", async () => {
    const response = await handleMockStravaRequest(
      new Request(`http://localhost:3000${MOCK_STRAVA_PATH}/api/v3/athlete`),
    );
    expect(response.status).toBe(404);
  });
});
