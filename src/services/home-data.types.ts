import type { AthleteSettings } from "./athlete-settings.types.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export type CalendarActivity = {
  id: string;
  title: string;
  start: string;
  end: string;
  sportType: string;
  distance: number | null;
  movingTime: number;
  hasStreams: boolean;
  hasHeartrate: boolean;
};

export function isMissingHeartrate(
  activity: Pick<CalendarActivity, "hasStreams" | "hasHeartrate">,
) {
  return activity.hasStreams && !activity.hasHeartrate;
}

export type HomeData = {
  signedIn: boolean;
  activities: CalendarActivity[];
  settings: AthleteSettings;
  training: TrainingPlan | null;
};
