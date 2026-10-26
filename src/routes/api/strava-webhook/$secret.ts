import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/strava-webhook/$secret")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleStravaWebhookRequest } = await import("@/services/strava-webhook.server.ts");
        return handleStravaWebhookRequest(request);
      },
      POST: async ({ request }) => {
        const { handleStravaWebhookRequest } = await import("@/services/strava-webhook.server.ts");
        return handleStravaWebhookRequest(request);
      },
    },
  },
});
