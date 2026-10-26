import { timingSafeEqual } from "node:crypto";

/**
 * Strava pushes events to `${STRAVA_WEBHOOK_PATH}/<STRAVA_WEBHOOK_SECRET>`. Strava does not sign
 * events, so the secret path is what keeps anyone else from deleting athletes (ADR 0031).
 */
export const STRAVA_WEBHOOK_PATH = "/api/strava-webhook";

export function stravaWebhookUrl(appUrl: string, secret: string) {
  return `${appUrl}${STRAVA_WEBHOOK_PATH}/${secret}`;
}

export type StravaWebhookPorts = {
  removeAthlete: (stravaAthleteId: string) => Promise<void>;
  removeActivity: (stravaAthleteId: string, activityId: string) => Promise<void>;
};

type StravaEvent = {
  object_type?: string;
  aspect_type?: string;
  object_id?: number;
  owner_id?: number;
  updates?: Record<string, string>;
};

/**
 * Strava retries an event up to three times unless it gets a 200 within two seconds, so every
 * event is safe to apply twice and unknown athletes or activities are no-ops in the ports.
 */
export async function handleStravaWebhook(
  request: Request,
  ports: StravaWebhookPorts,
  secret: string | undefined,
): Promise<Response> {
  const url = new URL(request.url);
  if (!secret || !matches(url.pathname.split("/").at(-1) ?? "", secret)) {
    return new Response("Not found", { status: 404 });
  }

  if (request.method === "GET") {
    const verifyToken = url.searchParams.get("hub.verify_token") ?? "";
    if (url.searchParams.get("hub.mode") !== "subscribe" || !matches(verifyToken, secret)) {
      return new Response("Forbidden", { status: 403 });
    }
    return Response.json({ "hub.challenge": url.searchParams.get("hub.challenge") });
  }

  let event: StravaEvent;
  try {
    event = (await request.json()) as StravaEvent;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const athleteId = String(event.owner_id);
  if (event.object_type === "athlete" && event.updates?.authorized === "false") {
    await ports.removeAthlete(athleteId);
  } else if (event.object_type === "activity" && event.aspect_type === "delete") {
    await ports.removeActivity(athleteId, String(event.object_id));
  }
  return new Response(null, { status: 200 });
}

function matches(given: string, secret: string) {
  const left = Buffer.from(given);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
