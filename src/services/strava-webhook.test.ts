import { describe, expect, it } from "vite-plus/test";

import { withoutWebhookSecret } from "./strava-webhook.ts";

describe("withoutWebhookSecret", () => {
  it("hides the secret in a webhook path", () => {
    expect(withoutWebhookSecret("/api/strava-webhook/s3cr3t")).toBe("/api/strava-webhook/:secret");
  });

  it("leaves other paths as they are", () => {
    expect(withoutWebhookSecret("/api/strava-webhookish")).toBe("/api/strava-webhookish");
  });
});
