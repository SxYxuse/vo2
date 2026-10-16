import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/activity-analysis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleActivityAnalysis } = await import("@/services/activity-analysis.server.ts");
        try {
          return await handleActivityAnalysis(request);
        } catch (error) {
          if (error instanceof Response) return error;
          throw error;
        }
      },
    },
  },
});
