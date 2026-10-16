import { z } from "zod";

function emptyToUndefined(value: unknown) {
  return typeof value === "string" && value.length === 0 ? undefined : value;
}

function requiredString(name: string) {
  return z.preprocess(
    emptyToUndefined,
    z.string({ error: `Missing required environment variable ${name}` }).min(1, {
      error: `Missing required environment variable ${name}`,
    }),
  );
}

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

export type Env = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ENV: string;
  STRAVA_MOCK: boolean;
  STRAVA_BASE_URL: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  OPENROUTER_API_KEY: string | undefined;
  LOKI_HOST: string | undefined;
};

export const envSchema = z
  .object({
    DATABASE_URL: requiredString("DATABASE_URL"),
    BETTER_AUTH_SECRET: requiredString("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("http://localhost:3000"),
    ),
    APP_ENV: optionalString,
    NODE_ENV: optionalString,
    STRAVA_MOCK: optionalString,
    STRAVA_CLIENT_ID: optionalString,
    STRAVA_CLIENT_SECRET: optionalString,
    OPENROUTER_API_KEY: optionalString,
    LOKI_HOST: optionalString,
  })
  .superRefine((raw, ctx) => {
    const appEnv = raw.APP_ENV ?? raw.NODE_ENV ?? "development";
    const stravaMock = raw.STRAVA_MOCK === "1" && appEnv !== "production";
    if (stravaMock) return;
    if (!raw.STRAVA_CLIENT_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["STRAVA_CLIENT_ID"],
        message: "STRAVA_CLIENT_ID is required unless STRAVA_MOCK=1",
      });
    }
    if (!raw.STRAVA_CLIENT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STRAVA_CLIENT_SECRET"],
        message: "STRAVA_CLIENT_SECRET is required unless STRAVA_MOCK=1",
      });
    }
  })
  .transform((raw): Env => {
    const appEnv = raw.APP_ENV ?? raw.NODE_ENV ?? "development";
    const stravaMock = raw.STRAVA_MOCK === "1" && appEnv !== "production";
    return {
      DATABASE_URL: raw.DATABASE_URL,
      BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: raw.BETTER_AUTH_URL,
      APP_ENV: appEnv,
      STRAVA_MOCK: stravaMock,
      STRAVA_BASE_URL: stravaMock
        ? `${raw.BETTER_AUTH_URL}/api/mock-strava`
        : "https://www.strava.com",
      STRAVA_CLIENT_ID: raw.STRAVA_CLIENT_ID ?? "mock",
      STRAVA_CLIENT_SECRET: raw.STRAVA_CLIENT_SECRET ?? "mock",
      OPENROUTER_API_KEY: raw.OPENROUTER_API_KEY,
      LOKI_HOST: raw.LOKI_HOST,
    };
  });

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return Object.freeze(result.data);
}
