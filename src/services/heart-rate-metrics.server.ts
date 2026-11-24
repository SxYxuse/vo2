import { athleteMetrics } from "@/db/schema.ts";

export const HEART_RATE_METRICS = {
  heartRate: athleteMetrics.heartRate,
  restHr: athleteMetrics.restHr,
  cyclingLthr: athleteMetrics.cyclingLthr,
  runLthr: athleteMetrics.runLthr,
  swimLthr: athleteMetrics.swimLthr,
  lthr: athleteMetrics.lthr,
};
