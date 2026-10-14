import type { ProfileSettings } from "./app-settings.types.ts";
import type { CalendarSettings } from "./calendar-settings.types.ts";
import type { FitnessLoad } from "./training-load.ts";
import type { PlannedSession, TrainingPlan } from "./training-plan.types.ts";

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

export function isMissingHeartrate(activity: Pick<CalendarActivity, "hasStreams" | "hasHeartrate">) {
  return activity.hasStreams && !activity.hasHeartrate;
}

export type SyncStatus = {
  activityCount: number;
  streamsPending: number;
  status: string;
  pausedUntil: string | null;
  lastError: string | null;
  shortLimitRemaining: number | null;
  dailyLimitRemaining: number | null;
  updatedAt: string | null;
};

export type HomeData = {
  signedIn: boolean;
  activities: CalendarActivity[];
  fitnessLoads: FitnessLoad[];
  status: SyncStatus | null;
  settings: CalendarSettings;
  profile: ProfileSettings;
  training: TrainingPlan | null;
  plannedSessions: PlannedSession[];
};

export type SyncResult = {
  activitiesUpserted: number;
  streamsFetched: number;
  streamsPending: number;
  done: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  rateLimit: {
    shortRemaining: number;
    dailyRemaining: number;
    nextWindowAt: string;
  };
};
