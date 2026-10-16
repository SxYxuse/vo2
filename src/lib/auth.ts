import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import * as schema from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";

type StravaAthlete = {
  id: number;
  username?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  profile?: string | null;
  profile_medium?: string | null;
};

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "strava",
          clientId: env.STRAVA_CLIENT_ID,
          clientSecret: env.STRAVA_CLIENT_SECRET,
          authorizationUrl: `${env.STRAVA_BASE_URL}/oauth/authorize`,
          tokenUrl: `${env.STRAVA_BASE_URL}/oauth/token`,
          // Strava expects a comma-separated scope list, not spaces.
          scopes: ["read,profile:read_all,activity:read_all"],
          pkce: false,
          accessTokenExpiresIn: 6 * 60 * 60,
          authorizationUrlParams: {
            approval_prompt: "auto",
          },
          getUserInfo: async (tokens) => {
            const response = await fetch(`${env.STRAVA_BASE_URL}/api/v3/athlete`, {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            });
            if (!response.ok) {
              logger.warn("auth.strava.athlete_failed", { status: response.status });
              return null;
            }
            const athlete = (await response.json()) as StravaAthlete;
            logger.info("auth.strava.athlete", { athleteId: athlete.id });
            const name =
              [athlete.firstname, athlete.lastname].filter(Boolean).join(" ").trim() ||
              athlete.username ||
              `Athlete ${athlete.id}`;
            return {
              id: String(athlete.id),
              name,
              email: `strava-${athlete.id}@users.vo.local`,
              image: athlete.profile || athlete.profile_medium || undefined,
              emailVerified: false,
            };
          },
        },
      ],
    }),
    tanstackStartCookies(),
  ],
});
