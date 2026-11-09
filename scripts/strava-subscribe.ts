import { parseEnv } from "../src/configs/env-schema.ts";
import { stravaWebhookUrl } from "../src/services/strava-webhook.ts";

// Run once per Strava app with `vp run strava:subscribe`, from a machine whose .env names the
// deployment Strava should push to. The app must be running: Strava calls it back to verify.
// Strava allows one push subscription per app, so an existing one is only replaced with --replace.

// Bun loads .env, and every worktree's .env sets STRAVA_MOCK=1, so without this check the script
// would quietly subscribe mock Strava when it was run for a real Strava app.
if (process.env.STRAVA_MOCK && !process.argv.includes("--mock")) {
  console.error(
    "STRAVA_MOCK is set (Bun reads it from .env), so this would subscribe mock Strava, not strava.com.\n" +
      "For a real Strava app, run with the deployment's environment and STRAVA_MOCK= (empty).\n" +
      "To subscribe mock Strava on purpose, add --mock.",
  );
  process.exit(1);
}

const env = parseEnv();
if (!env.STRAVA_WEBHOOK_SECRET) throw new Error("Set STRAVA_WEBHOOK_SECRET first");

const endpoint = `${env.STRAVA_BASE_URL}/api/v3/push_subscriptions`;
const credentials = { client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET };
const callbackUrl = stravaWebhookUrl(env.BETTER_AUTH_URL, env.STRAVA_WEBHOOK_SECRET);

const listed = await fetch(`${endpoint}?${new URLSearchParams(credentials)}`);
if (!listed.ok) await fail("Strava refused to list subscriptions", listed);
const existing = (await listed.json()) as Array<{ id: number; callback_url: string }>;

for (const subscription of existing) {
  if (!process.argv.includes("--replace")) {
    console.error(
      `Strava already pushes to ${subscription.callback_url} (subscription ${subscription.id}). ` +
        "Rerun with --replace to point it at this deployment instead.",
    );
    process.exit(1);
  }
  const removed = await fetch(
    `${endpoint}/${subscription.id}?${new URLSearchParams(credentials)}`,
    { method: "DELETE" },
  );
  if (!removed.ok) await fail(`Strava refused to delete subscription ${subscription.id}`, removed);
}

const response = await fetch(endpoint, {
  method: "POST",
  body: new URLSearchParams({
    ...credentials,
    callback_url: callbackUrl,
    verify_token: env.STRAVA_WEBHOOK_SECRET,
  }),
});
if (!response.ok) await fail("Strava refused the subscription", response);
console.log(`Subscribed: ${JSON.stringify(await response.json())}`);

async function fail(message: string, response: Response): Promise<never> {
  console.error(`${message} (${response.status}): ${await response.text()}`);
  process.exit(1);
}
