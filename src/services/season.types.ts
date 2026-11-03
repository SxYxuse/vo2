import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";

import type { components } from "@/integrations/strava/strava.types.ts";
import { SPORT_GROUPS, sportGroupFor } from "./sport-groups.ts";

type StravaSportType = components["schemas"]["SportType"];

/** Only sport-group types can be a goal: other sport types are never shown (ADR 0029). */
export const GOAL_SPORT_TYPES = SPORT_GROUPS.flatMap((group) => group.members) as StravaSportType[];

/**
 * How much a goal matters, and so what the athlete wants from it: the plan peaks for A to perform,
 * eases off for B to finish well, and trains through C to finish (ADR 0024, ADR 0049).
 */
export const GOAL_PRIORITIES = [
  {
    id: "A",
    label: "A race · Perform",
    hint: "Race for a time or a place: full build, peak, and taper.",
  },
  {
    id: "B",
    label: "B race · Finish well",
    hint: "A strong, even effort: a few lighter days before it, no recovery week after.",
  },
  {
    id: "C",
    label: "C race · Finish",
    hint: "Reach the line: trained through, like a hard session.",
  },
] as const;

export type GoalPriority = (typeof GOAL_PRIORITIES)[number]["id"];

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
  priority: z.enum(["A", "B", "C"]).default("A"),
});

export type GoalInput = z.input<typeof goalInputSchema>;

/** A season as copied text, to paste into another VO2 account or install. */
export const seasonCopySchema = z.object({
  vo2Season: z.literal(1),
  goals: z.array(goalInputSchema).min(1).max(500),
});

export function seasonCopy(goals: Goal[]): z.input<typeof seasonCopySchema> {
  return {
    vo2Season: 1,
    goals: goals.map((goal) => ({
      name: goal.name,
      sportType: goal.sportType,
      date: goal.date,
      distanceM: goal.distanceM,
      elevationGainM: goal.elevationGainM,
      priority: goal.priority,
    })),
  };
}

const goalKey = (goal: Pick<Goal, "name" | "sportType" | "date">) =>
  `${goal.date}|${goal.sportType}|${goal.name.trim().toLowerCase()}`;

/** The pasted goals the season doesn't have yet, so pasting twice adds nothing. */
export function newGoals<T extends Pick<Goal, "name" | "sportType" | "date">>(
  pasted: T[],
  existing: Pick<Goal, "name" | "sportType" | "date">[],
) {
  const seen = new Set(existing.map(goalKey));
  return pasted.filter((goal) => {
    const key = goalKey(goal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type Goal = z.output<typeof goalInputSchema> & { id: string };

/** Goals on the same date are one event, such as a triathlon entered as swim, ride, and run. */
export type SeasonEvent = { date: string; goals: Goal[] };

export type PastGoal = Goal & { activityId: string | null };

export type SeasonData = {
  signedIn: boolean;
  /** Sport types the athlete shows in Settings, in picker order; every type when none is set. */
  sportTypes: string[];
  /** Today in the athlete's timezone, so days left match the week target. */
  today: string;
  upcoming: SeasonEvent[];
  past: PastGoal[];
  /**
   * The VDOT of the athlete's training paces, for predicted race times; null without running
   * history, and undefined when no upcoming goal has a time to predict.
   */
  vdot?: number | null;
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

/** Multisport legs in race order: swim, ride, run, then the rest. */
const LEG_ORDER = ["swimming", "cycling", "running", "walking"];

function legRank(goal: Goal) {
  const index = LEG_ORDER.indexOf(sportGroupFor(goal.sportType)?.id ?? "");
  return index < 0 ? LEG_ORDER.length : index;
}

/** Same-date goals grouped into events, in date order; legs in race order. */
export function seasonEvents(goals: Goal[]): SeasonEvent[] {
  const sorted = [...goals].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || legRank(a) - legRank(b) || a.name.localeCompare(b.name),
  );
  const events: SeasonEvent[] = [];
  for (const goal of sorted) {
    const last = events.at(-1);
    if (last?.date === goal.date) last.goals.push(goal);
    else events.push({ date: goal.date, goals: [goal] });
  }
  return events;
}

const PRIORITY_RANK: Record<GoalPriority, number> = { A: 0, B: 1, C: 2 };

/** An event matters as much as its most important goal. */
export function eventPriority(event: SeasonEvent): GoalPriority {
  return event.goals.reduce<GoalPriority>(
    (best, goal) => (PRIORITY_RANK[goal.priority] < PRIORITY_RANK[best] ? goal.priority : best),
    "C",
  );
}

/** Separates an event's name from its leg: "Ironman WA · Bike". */
export const LEG_SEPARATOR = " · ";

/** One name for an event: the shared name of its legs, or the names joined. */
export function eventTitle(event: SeasonEvent) {
  const bases = [...new Set(event.goals.map((goal) => goal.name.split(LEG_SEPARATOR)[0]!.trim()))];
  return bases.join(" + ");
}

/** The leg's own label within its event, or null for a one-goal event. */
export function legLabel(goal: Goal, event: SeasonEvent) {
  if (event.goals.length < 2) return null;
  const [, leg] = goal.name.split(LEG_SEPARATOR);
  return leg?.trim() || null;
}

/** The event the plan builds toward: the next with an A goal, else the next with a B goal. */
export function anchorEvent(events: SeasonEvent[]): SeasonEvent | null {
  return (
    events.find((event) => eventPriority(event) === "A") ??
    events.find((event) => eventPriority(event) === "B") ??
    null
  );
}
