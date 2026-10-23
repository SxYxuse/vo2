import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { coachNoteInputSchema, type WeekCoachState } from "./week-plan.ts";

export const loadWeekCoach = createServerFn({ method: "GET" }).handler(
  async (): Promise<WeekCoachState> => {
    const { loadWeekCoachImpl } = await import("./week-coach.server.ts");
    return loadWeekCoachImpl();
  },
);

/** Asks the coach again when a sync or a note changed the week; free when nothing did. */
export const replanWeek = createServerFn({ method: "POST" }).handler(
  async (): Promise<WeekCoachState> => {
    const { replanWeekImpl } = await import("./week-coach.server.ts");
    return replanWeekImpl();
  },
);

export const addCoachNote = createServerFn({ method: "POST" })
  .validator(coachNoteInputSchema)
  .handler(async ({ data }): Promise<WeekCoachState> => {
    const { addCoachNoteImpl } = await import("./week-coach.server.ts");
    return addCoachNoteImpl(data);
  });

export const removeCoachNote = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<WeekCoachState> => {
    const { removeCoachNoteImpl } = await import("./week-coach.server.ts");
    return removeCoachNoteImpl(data.id);
  });
