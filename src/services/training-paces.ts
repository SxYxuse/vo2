import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { raceResultSchema, type TrainingPaces } from "./training-paces.types.ts";

export const loadTrainingPaces = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrainingPaces> => {
    const { loadTrainingPacesImpl } = await import("./training-paces.server.ts");
    return loadTrainingPacesImpl();
  },
);

/** Sets the athlete's race result, or clears it with null. */
export const saveRaceResult = createServerFn({ method: "POST" })
  .validator(z.object({ raceResult: raceResultSchema.nullable() }))
  .handler(async ({ data }): Promise<TrainingPaces> => {
    const { saveRaceResultImpl } = await import("./training-paces.server.ts");
    return saveRaceResultImpl(data.raceResult);
  });
