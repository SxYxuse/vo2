import { StravaApi } from "@/integrations/strava/client.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import { getStravaAccessToken } from "@/lib/strava-token.server.ts";
import { zoneTopsFromStrava } from "./strava-zones.ts";

export async function loadStravaZoneTopsImpl() {
  const session = await getRequiredSession();
  const zones = await new StravaApi(await getStravaAccessToken(session.user.id)).getAthleteZones();
  const tops = zoneTopsFromStrava(zones);
  if (!tops) {
    logger.warn("strava.zones_unusable", { ranges: zones.heart_rate?.zones?.length ?? 0 });
    throw new Error("Strava has no heart-rate zones VO2 can use. Enter them here instead.");
  }
  return tops;
}
