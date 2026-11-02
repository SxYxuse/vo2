import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleCoachChatHistory } = await import("@/services/coach.server.ts");
        return handleCoachChatHistory(request);
      },
      POST: async ({ request }) => {
        const { handleCoachChat } = await import("@/services/coach.server.ts");
        try {
          return await handleCoachChat(request);
        } catch (error) {
          if (error instanceof Response) return error;
          throw error;
        }
      },
    },
  },
});
