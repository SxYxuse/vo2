import { createFileRoute } from "@tanstack/react-router";
import { handleMockStravaRequest } from "@/integrations/strava/mock-server";

export const Route = createFileRoute("/api/mock-strava/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleMockStravaRequest(request),
      POST: ({ request }) => handleMockStravaRequest(request),
      DELETE: ({ request }) => handleMockStravaRequest(request),
    },
  },
});
