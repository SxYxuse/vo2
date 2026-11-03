import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type CoachChatSummary = { id: string; title: string; updatedAt: string };

/** The athlete's coach chats, most recently active first. */
export const listCoachChats = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoachChatSummary[]> => {
    const [{ getOptionalSession }, { listCoachChatsFor }] = await Promise.all([
      import("@/lib/session.server.ts"),
      import("./coach-chats.server.ts"),
    ]);
    const session = await getOptionalSession();
    return session ? listCoachChatsFor(session.user.id) : [];
  },
);

export const deleteCoachChat = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<void> => {
    const [{ getRequiredSession }, { deleteCoachChatFor }] = await Promise.all([
      import("@/lib/session.server.ts"),
      import("./coach-chats.server.ts"),
    ]);
    const session = await getRequiredSession();
    await deleteCoachChatFor(session.user.id, data.id);
  });
