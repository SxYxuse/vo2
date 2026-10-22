import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";

import type { components } from "@/integrations/strava/strava.types.ts";
import { SPORT_GROUPS, sportGroupFor } from "./sport-groups.ts";

type StravaSportType = components["schemas"]["SportType"];

const OTHER_SPORT_TYPES = [
  "AlpineSki",
  "BackcountrySki",
  "Badminton",
  "Basketball",
  "Canoeing",
  "Cricket",
  "Crossfit",
  "Dance",
  "Elliptical",
  "Golf",
  "HighIntensityIntervalTraining",
  "IceSkate",
  "InlineSkate",
  "Kayaking",
  "Kitesurf",
  "NordicSki",
  "Padel",
  "PhysicalTherapy",
  "Pickleball",
  "Pilates",
  "Racquetball",
  "RockClimbing",
  "RollerSki",
  "Rowing",
  "Sail",
  "Skateboard",
  "Snowboard",
  "Snowshoe",
  "Soccer",
  "Squash",
  "StairStepper",
  "StandUpPaddling",
  "Surfing",
  "TableTennis",
  "Tennis",
  "VirtualRow",
  "Volleyball",
  "WeightTraining",
  "Wheelchair",
  "Windsurf",
  "Workout",
  "Yoga",
] as const satisfies readonly StravaSportType[];

/** Every Strava sport type can be a goal; the sport groups come first in pickers. */
export const GOAL_SPORT_TYPES = [
  ...SPORT_GROUPS.flatMap((group) => group.members),
  ...OTHER_SPORT_TYPES,
] as StravaSportType[];

export const GOAL_OBJECTIVES = [
  { id: "finish", label: "Finish", hint: "Reach the line in good shape." },
  { id: "finishWell", label: "Finish well", hint: "Hold a strong, even effort to the end." },
  { id: "perform", label: "Perform", hint: "Race for a time or a place." },
] as const;

export type GoalObjective = (typeof GOAL_OBJECTIVES)[number]["id"];

/** Goals closer than this share a taper, so the athlete picks which one to peak for. */
export const CLUSTER_GAP_DAYS = 28;

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date." });

export const goalInputSchema = z.object({
  name: z.string().trim().min(1, { error: "Name your goal." }).max(120),
  sportType: z.enum(GOAL_SPORT_TYPES as [StravaSportType, ...StravaSportType[]]),
  date: dateKeySchema,
  distanceM: z
    .number({ error: "Enter a number." })
    .positive({ error: "Distance must be above 0." })
    .max(5_000_000, { error: "5,000 km at most." })
    .nullable(),
  elevationGainM: z
    .number({ error: "Enter a number." })
    .min(0)
    .max(50_000, { error: "50,000 m at most." })
    .nullable(),
  objective: z.enum(["finish", "finishWell", "perform"]),
});

export type GoalInput = z.infer<typeof goalInputSchema>;

export type Goal = GoalInput & { id: string; main: boolean };

/** Goals on the same date are one event, such as a triathlon entered as swim, ride, and run. */
export type SeasonEvent = { date: string; goals: Goal[] };

export type SeasonCluster = {
  events: SeasonEvent[];
  /** The event the plan peaks for. */
  mainDate: string;
  /** False while VO2's default stands; only asked when the cluster has more than one event. */
  chosen: boolean;
};

export type PastGoal = Goal & { activityId: string | null };

export type SeasonData = {
  signedIn: boolean;
  /** Sport types the athlete shows in Settings, in picker order; every type when none is set. */
  sportTypes: string[];
  /** Today in the athlete's timezone, so days left match the week target. */
  today: string;
  upcoming: SeasonCluster[];
  past: PastGoal[];
};

/** The sport types a goal can pick: those the athlete shows in Settings. */
export function goalSportTypes(shown: Record<string, { visible: boolean }>) {
  const enabled = GOAL_SPORT_TYPES.filter((type) => shown[type]?.visible);
  return enabled.length ? enabled : [...GOAL_SPORT_TYPES];
}

export function daysBetween(fromKey: string, toKey: string) {
  return differenceInCalendarDays(parseISO(toKey), parseISO(fromKey));
}

export function formatDaysLeft(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return days === -1 ? "Yesterday" : `${-days} days ago`;
  return `In ${days} days`;
}

/** Rough speeds until the plan predicts from the athlete's own activities. */
const ROUGH_KMH = { cycling: 25, running: 10, swimming: 3, walking: 5 } as const;
const OTHER_KMH = 10;
/** Climbing cost: about an hour per 600 m on foot, per 1,000 m on a bike. */
const CLIMB_M_PER_HOUR = { cycling: 1000, running: 600, swimming: Infinity, walking: 400 } as const;

/** A rough duration used only to default the main goal of a cluster. */
export function roughGoalHours(goal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">) {
  if (goal.distanceM == null) return 0;
  const group = sportGroupFor(goal.sportType)?.id;
  const flat = goal.distanceM / 1000 / (group ? ROUGH_KMH[group] : OTHER_KMH);
  const climb = group ? (goal.elevationGainM ?? 0) / CLIMB_M_PER_HOUR[group] : 0;
  return flat + climb;
}

function eventsOf(goals: Goal[]): SeasonEvent[] {
  const sorted = [...goals].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  const events: SeasonEvent[] = [];
  for (const goal of sorted) {
    const last = events.at(-1);
    if (last?.date === goal.date) last.goals.push(goal);
    else events.push({ date: goal.date, goals: [goal] });
  }
  return events;
}

/**
 * Groups goals into clusters: events less than CLUSTER_GAP_DAYS after the previous one join its
 * cluster. The main event is the athlete's pick, else the longest by rough duration.
 */
export function seasonClusters(goals: Goal[]): SeasonCluster[] {
  const clusters: SeasonEvent[][] = [];
  for (const event of eventsOf(goals)) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (current && previous && daysBetween(previous.date, event.date) < CLUSTER_GAP_DAYS) {
      current.push(event);
    } else {
      clusters.push([event]);
    }
  }
  return clusters.map((events) => {
    const picked =
      events.length > 1 ? events.find((event) => event.goals.some((goal) => goal.main)) : undefined;
    const hours = (event: SeasonEvent) =>
      event.goals.reduce((sum, goal) => sum + roughGoalHours(goal), 0);
    const longest = events.reduce((best, event) => (hours(event) > hours(best) ? event : best));
    return { events, mainDate: (picked ?? longest).date, chosen: picked != null };
  });
}

/**
 * The stored main flag each goal should have: set only on the goals of a picked main event in a
 * cluster of several events. A cluster that broke up or merged loses stale picks.
 */
export function normalizedMainFlags(goals: Goal[]): Map<string, boolean> {
  const flags = new Map(goals.map((goal) => [goal.id, false]));
  for (const cluster of seasonClusters(goals)) {
    if (!cluster.chosen) continue;
    const main = cluster.events.find((event) => event.date === cluster.mainDate);
    for (const goal of main?.goals ?? []) flags.set(goal.id, true);
  }
  return flags;
}

/** Flags after the athlete picks `goalId`'s event as the main one of its cluster. */
export function mainFlagsAfterPick(goals: Goal[], goalId: string): Map<string, boolean> {
  const picked = goals.find((goal) => goal.id === goalId);
  if (!picked) return normalizedMainFlags(goals);
  const cluster = seasonClusters(goals).find((candidate) =>
    candidate.events.some((event) => event.date === picked.date),
  );
  const inCluster = new Set(cluster?.events.flatMap((event) => event.goals.map((goal) => goal.id)));
  return normalizedMainFlags(
    goals.map((goal) =>
      inCluster.has(goal.id) ? { ...goal, main: goal.date === picked.date } : goal,
    ),
  );
}
