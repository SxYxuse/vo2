import { parseEnv } from "../src/configs/env-schema.ts";
import { STRAVA_WEBHOOK_PATH } from "../src/services/strava-webhook.ts";

// Run once per Strava app with `vp run strava:subscribe`, from a machine whose .env names the
// deployment Strava should push to. The app must be running: Strava calls it back to verify.
// Strava allows one push subscription per app, so an existing one is only replaced with --replace.

const env = parseEnv();
if (!env.STRAVA_WEBHOOK_SECRET) throw new Error("Set STRAVA_WEBHOOK_SECRET first");

const endpoint = `${env.STRAVA_BASE_URL}/api/v3/push_subscriptions`;
const credentials = { client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET };
const callbackUrl = `${env.BETTER_AUTH_URL}${STRAVA_WEBHOOK_PATH}/${env.STRAVA_WEBHOOK_SECRET}`;

const existing = (await (
  await fetch(`${endpoint}?${new URLSearchParams(credentials)}`)
).json()) as Array<{ id: number; callback_url: string }>;

for (const subscription of existing) {
  if (!process.argv.includes("--replace")) {
    console.error(
      `Strava already pushes to ${subscription.callback_url} (subscription ${subscription.id}). ` +
        "Rerun with --replace to point it at this deployment instead.",
    );
    process.exit(1);
  }
  await fetch(`${endpoint}/${subscription.id}?${new URLSearchParams(credentials)}`, {
    method: "DELETE",
  });
}

const response = await fetch(endpoint, {
  method: "POST",
  body: new URLSearchParams({
    ...credentials,
    callback_url: callbackUrl,
    verify_token: env.STRAVA_WEBHOOK_SECRET,
  }),
});
if (!response.ok) {
  console.error(`Strava refused the subscription (${response.status}): ${await response.text()}`);
  process.exit(1);
}
console.log(`Subscribed: ${JSON.stringify(await response.json())}`);
