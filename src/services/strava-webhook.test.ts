import { describe, expect, it } from "vite-plus/test";

import { STRAVA_WEBHOOK_PATH, handleStravaWebhook } from "./strava-webhook.ts";

const SECRET = "s3cret";

function webhookRequest(path: string, init?: RequestInit) {
  return new Request(`http://localhost:3000${STRAVA_WEBHOOK_PATH}/${path}`, init);
}

function event(body: Record<string, unknown>) {
  return webhookRequest(SECRET, { method: "POST", body: JSON.stringify(body) });
}

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      removeAthlete: async (athleteId: string) => void calls.push(`athlete ${athleteId}`),
      removeActivity: async (athleteId: string, activityId: string) =>
        void calls.push(`activity ${athleteId}/${activityId}`),
    },
  };
}

describe("handleStravaWebhook", () => {
  it("echoes the challenge when Strava verifies the subscription", async () => {
    const response = await handleStravaWebhook(
      webhookRequest(`${SECRET}?hub.mode=subscribe&hub.verify_token=${SECRET}&hub.challenge=abc`),
      recorder().ports,
      SECRET,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ "hub.challenge": "abc" });
  });

  it("refuses a handshake with the wrong verify token", async () => {
    const response = await handleStravaWebhook(
      webhookRequest(`${SECRET}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc`),
      recorder().ports,
      SECRET,
    );

    expect(response.status).toBe(403);
  });

  it("removes the athlete when they revoke VO2 on Strava", async () => {
    const { calls, ports } = recorder();

    const response = await handleStravaWebhook(
      event({
        object_type: "athlete",
        aspect_type: "update",
        object_id: 42,
        owner_id: 42,
        updates: { authorized: "false" },
      }),
      ports,
      SECRET,
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual(["athlete 42"]);
  });

  it("removes an activity the athlete deleted on Strava", async () => {
    const { calls, ports } = recorder();

    await handleStravaWebhook(
      event({ object_type: "activity", aspect_type: "delete", object_id: 900, owner_id: 42 }),
      ports,
      SECRET,
    );

    expect(calls).toEqual(["activity 42/900"]);
  });

  it("acknowledges other events without changing anything", async () => {
    const { calls, ports } = recorder();

    for (const body of [
      { object_type: "activity", aspect_type: "create", object_id: 900, owner_id: 42 },
      { object_type: "activity", aspect_type: "update", object_id: 900, owner_id: 42 },
      { object_type: "athlete", aspect_type: "update", object_id: 42, owner_id: 42, updates: {} },
    ]) {
      expect((await handleStravaWebhook(event(body), ports, SECRET)).status).toBe(200);
    }

    expect(calls).toEqual([]);
  });

  it("rejects a body that is not an event", async () => {
    const { calls, ports } = recorder();

    const response = await handleStravaWebhook(
      webhookRequest(SECRET, { method: "POST", body: "not json" }),
      ports,
      SECRET,
    );

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("ignores requests without the secret, so nobody else can delete athletes", async () => {
    const { calls, ports } = recorder();
    const deauthorize = {
      object_type: "athlete",
      aspect_type: "update",
      object_id: 42,
      owner_id: 42,
      updates: { authorized: "false" },
    };

    const wrong = await handleStravaWebhook(
      webhookRequest("guess", { method: "POST", body: JSON.stringify(deauthorize) }),
      ports,
      SECRET,
    );
    const unconfigured = await handleStravaWebhook(event(deauthorize), ports, undefined);

    expect(wrong.status).toBe(404);
    expect(unconfigured.status).toBe(404);
    expect(calls).toEqual([]);
  });
});
