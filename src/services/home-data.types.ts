import type { AthleteSettings } from "./athlete-settings.types.ts";

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

/** A season goal shown on its date (ADR 0021). */
export type CalendarGoal = { id: string; name: string; sportType: string; date: string };

export type HomeData = {
  signedIn: boolean;
  activities: CalendarActivity[];
  goals: CalendarGoal[];
  settings: AthleteSettings;
};
