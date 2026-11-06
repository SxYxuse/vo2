import { createFileRoute } from "@tanstack/react-router";
import { handleMockBRouterRequest } from "@/integrations/brouter/mock-server";

export const Route = createFileRoute("/api/mock-brouter/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleMockBRouterRequest(request),
    },
  },
});
