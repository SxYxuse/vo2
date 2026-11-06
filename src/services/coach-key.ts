import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { COACH_PROVIDER_IDS, type CoachFeature, type CoachProvider } from "./coach-models.ts";

export type CoachStatus = {
  /** The mock coach answers without a key (mock Strava only). */
  mocked: boolean;
  /** When the athlete saved each provider's key; a provider without one is absent. */
  keys: Partial<Record<CoachProvider, string>>;
  /** Whether the key each feature's model needs is saved. */
  ready: Record<CoachFeature, boolean>;
};

export const getCoachStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoachStatus> => {
    const [{ getOptionalSession }, { coachKeysSavedAt }, { isCoachMocked }, { coachModelsFor }] =
      await Promise.all([
        import("@/lib/session.server.ts"),
        import("./coach-key.server.ts"),
        import("./coach-model.server.ts"),
        import("./athlete-settings.server.ts"),
      ]);
    const session = await getOptionalSession();
    if (!session) return { mocked: isCoachMocked(), keys: {}, ready: { chat: false, plan: false } };
    const [keys, models] = await Promise.all([
      coachKeysSavedAt(session.user.id),
      coachModelsFor(session.user.id),
    ]);
    return {
      mocked: isCoachMocked(),
      keys,
      ready: { chat: models.chat.provider in keys, plan: models.plan.provider in keys },
    };
  },
);

const providerSchema = z.enum(COACH_PROVIDER_IDS);

export const saveCoachKey = createServerFn({ method: "POST" })
  .validator(z.object({ provider: providerSchema, key: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }): Promise<void> => {
    const { saveCoachKeyImpl } = await import("./coach-key.server.ts");
    await saveCoachKeyImpl(data.provider, data.key);
  });

export const removeCoachKey = createServerFn({ method: "POST" })
  .validator(z.object({ provider: providerSchema }))
  .handler(async ({ data }): Promise<void> => {
    const { removeCoachKeyImpl } = await import("./coach-key.server.ts");
    await removeCoachKeyImpl(data.provider);
  });
