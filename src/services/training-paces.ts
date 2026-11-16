import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  paceChoiceSchema,
  raceResultSchema,
  type PredictedTimeTrend,
  type TrainingPaces,
} from "./training-paces.types.ts";

export const loadTrainingPaces = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrainingPaces> => {
    const { loadTrainingPacesImpl } = await import("./training-paces.server.ts");
    return loadTrainingPacesImpl();
  },
);

export const loadPredictedTimeTrend = createServerFn({ method: "GET" }).handler(
  async (): Promise<PredictedTimeTrend> => {
    const { loadPredictedTimeTrendImpl } = await import("./training-paces.server.ts");
    return loadPredictedTimeTrendImpl();
  },
);

export const saveRaceResult = createServerFn({ method: "POST" })
  .validator(z.object({ raceResult: raceResultSchema.nullable() }))
  .handler(async ({ data }): Promise<TrainingPaces> => {
    const { saveRaceResultImpl } = await import("./training-paces.server.ts");
    return saveRaceResultImpl(data.raceResult);
  });

export const savePaceChoice = createServerFn({ method: "POST" })
  .validator(z.object({ choice: paceChoiceSchema }))
  .handler(async ({ data }): Promise<TrainingPaces> => {
    const { savePaceChoiceImpl } = await import("./training-paces.server.ts");
    return savePaceChoiceImpl(data.choice);
  });
