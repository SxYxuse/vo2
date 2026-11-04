import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  goalInputSchema,
  goalUpdateSchema,
  seasonCopySchema,
  type SeasonData,
} from "./season.types.ts";

const idSchema = z.object({ id: z.string() });

export const loadSeason = createServerFn({ method: "GET" }).handler(
  async (): Promise<SeasonData> => {
    const { loadSeasonImpl } = await import("./season.server.ts");
    return loadSeasonImpl();
  },
);

export const createGoal = createServerFn({ method: "POST" })
  .validator(goalInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createGoalImpl } = await import("./season.server.ts");
    return createGoalImpl(data);
  });

export const updateGoal = createServerFn({ method: "POST" })
  .validator(goalUpdateSchema)
  .handler(async ({ data }): Promise<void> => {
    const { updateGoalImpl } = await import("./season.server.ts");
    await updateGoalImpl(data);
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }): Promise<void> => {
    const { deleteGoalImpl } = await import("./season.server.ts");
    await deleteGoalImpl(data.id);
  });

export const createEvent = createServerFn({ method: "POST" })
  .validator(z.object({ legs: z.array(goalInputSchema).min(2).max(5) }))
  .handler(async ({ data }): Promise<{ ids: string[] }> => {
    const { createEventImpl } = await import("./season.server.ts");
    return createEventImpl(data);
  });

export const pasteSeason = createServerFn({ method: "POST" })
  .validator(seasonCopySchema)
  .handler(async ({ data }): Promise<{ added: number; skipped: number }> => {
    const { pasteSeasonImpl } = await import("./season.server.ts");
    return pasteSeasonImpl(data.goals);
  });
