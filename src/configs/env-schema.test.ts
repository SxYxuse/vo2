import { describe, expect, it } from "vite-plus/test";

import { parseEnv } from "./env-schema.ts";

const required = {
  DATABASE_URL: "postgresql://vo2:vo2@localhost:55432/vo2",
  BETTER_AUTH_SECRET: "secret",
};

describe("parseEnv", () => {
  it("reads DATABASE_URL and defaults Better Auth URL and APP_ENV", () => {
    const env = parseEnv({
      ...required,
      STRAVA_CLIENT_ID: "id",
      STRAVA_CLIENT_SECRET: "secret",
    });

    expect(env.DATABASE_URL).toBe(required.DATABASE_URL);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.APP_ENV).toBe("development");
    expect(env.STRAVA_MOCK).toBe(false);
    expect(env.STRAVA_BASE_URL).toBe("https://www.strava.com");
    expect(env.LOKI_HOST).toBeUndefined();
  });

  it("treats empty strings as missing", () => {
    expect(() =>
      parseEnv({
        ...required,
        DATABASE_URL: "",
        STRAVA_CLIENT_ID: "id",
        STRAVA_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("requires Strava credentials unless mock is on", () => {
    expect(() => parseEnv(required)).toThrow(/STRAVA_CLIENT_ID/);
    expect(() =>
      parseEnv({
        ...required,
        STRAVA_CLIENT_ID: "id",
      }),
    ).toThrow(/STRAVA_CLIENT_SECRET/);
  });

  it("fills mock Strava credentials and base URL when STRAVA_MOCK=1", () => {
    const env = parseEnv({
      ...required,
      STRAVA_MOCK: "1",
      BETTER_AUTH_URL: "http://localhost:3000",
    });

    expect(env.STRAVA_MOCK).toBe(true);
    expect(env.STRAVA_BASE_URL).toBe("http://localhost:3000/api/mock-strava");
    expect(env.STRAVA_CLIENT_ID).toBe("mock");
    expect(env.STRAVA_CLIENT_SECRET).toBe("mock");
  });

  it("ignores STRAVA_MOCK in production and still requires credentials", () => {
    expect(() =>
      parseEnv({
        ...required,
        STRAVA_MOCK: "1",
        APP_ENV: "production",
      }),
    ).toThrow(/STRAVA_CLIENT_ID/);

    const env = parseEnv({
      ...required,
      STRAVA_MOCK: "1",
      APP_ENV: "production",
      STRAVA_CLIENT_ID: "id",
      STRAVA_CLIENT_SECRET: "secret",
    });

    expect(env.STRAVA_MOCK).toBe(false);
    expect(env.STRAVA_BASE_URL).toBe("https://www.strava.com");
  });

  it("falls back to NODE_ENV when APP_ENV is absent", () => {
    const env = parseEnv({
      ...required,
      NODE_ENV: "test",
      STRAVA_CLIENT_ID: "id",
      STRAVA_CLIENT_SECRET: "secret",
    });

    expect(env.APP_ENV).toBe("test");
  });
});
