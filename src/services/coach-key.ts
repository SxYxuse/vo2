import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type CoachStatus = {
  /** The mock coach answers without a key (mock Strava only). */
  mocked: boolean;
  /** When the athlete saved their OpenRouter key; null without one. */
  keySavedAt: string | null;
};

export const getCoachStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoachStatus> => {
    const [{ getOptionalSession }, { coachKeySavedAt }, { isCoachMocked }] = await Promise.all([
      import("@/lib/session.server.ts"),
      import("./coach-key.server.ts"),
      import("./coach-model.server.ts"),
    ]);
    const session = await getOptionalSession();
    return {
      mocked: isCoachMocked(),
      keySavedAt: session ? await coachKeySavedAt(session.user.id) : null,
    };
  },
);

export const saveCoachKey = createServerFn({ method: "POST" })
  .validator(z.object({ key: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }): Promise<void> => {
    const { saveCoachKeyImpl } = await import("./coach-key.server.ts");
    await saveCoachKeyImpl(data.key);
  });

export const removeCoachKey = createServerFn({ method: "POST" }).handler(
  async (): Promise<void> => {
    const { removeCoachKeyImpl } = await import("./coach-key.server.ts");
    await removeCoachKeyImpl();
  },
);
