function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const appEnv = () => readEnv("APP_ENV") ?? process.env.NODE_ENV ?? "development";
const betterAuthUrl = () => readEnv("BETTER_AUTH_URL") ?? "http://localhost:3000";
/** Never honored in production, so a stray env var cannot bypass real Strava sign-in. */
const stravaMock = () => readEnv("STRAVA_MOCK") === "1" && appEnv() !== "production";

export const serverEnv = {
  databaseUrl: () => requireEnv("DATABASE_URL"),
  betterAuthUrl,
  betterAuthSecret: () => requireEnv("BETTER_AUTH_SECRET"),
  stravaMock,
  /** Origin for Strava OAuth and the v3 API; the in-app mock when STRAVA_MOCK=1. */
  stravaBaseUrl: () =>
    stravaMock() ? `${betterAuthUrl()}/api/mock-strava` : "https://www.strava.com",
  stravaClientId: () => readEnv("STRAVA_CLIENT_ID") ?? (stravaMock() ? "mock" : undefined),
  stravaClientSecret: () => readEnv("STRAVA_CLIENT_SECRET") ?? (stravaMock() ? "mock" : undefined),
  openRouterApiKey: () => readEnv("OPENROUTER_API_KEY"),
  appEnv,
  lokiHost: () => readEnv("LOKI_HOST"),
};
