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

export const serverEnv = {
  databaseUrl: () => requireEnv("DATABASE_URL"),
  betterAuthUrl: () => readEnv("BETTER_AUTH_URL") ?? "http://localhost:3000",
  betterAuthSecret: () => requireEnv("BETTER_AUTH_SECRET"),
  stravaClientId: () => readEnv("STRAVA_CLIENT_ID"),
  stravaClientSecret: () => readEnv("STRAVA_CLIENT_SECRET"),
  openRouterApiKey: () => readEnv("OPENROUTER_API_KEY"),
};
