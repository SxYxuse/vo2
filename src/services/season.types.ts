import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";

import type { components } from "@/integrations/strava/strava.types.ts";
import { SPORT_GROUPS, sportGroupFor } from "./sport-groups.ts";

type StravaSportType = components["schemas"]["SportType"];

export const GOAL_SPORT_TYPES = SPORT_GROUPS.flatMap((group) => group.members) as StravaSportType[];

export const GOAL_PRIORITIES = [
  {
    id: "A",
    label: "Main goal · Perform, 100 %",
    hint: "Race for a time or a place: full build, peak, and taper, then a recovery week.",
  },
  {
    id: "B",
    label: "Supporting race",
    hint: "Along the way to a main goal, at the effort you choose below.",
  },
] as const;

export const GOAL_EFFORTS = [
  {
    id: "fun",
    label: "Run for fun",
    hint: "Easy pace. It counts as the week's easy run; the plan barely changes.",
  },
  {
    id: "steady",
    label: "Strong and steady, 70–80 %",
    hint: "The week's other runs stay easy, race week is lighter, and so is the week after.",
  },
  {
    id: "allOut",
    label: "Go all out",
    hint: "A taper before it and a recovery week after, without its own build.",
  },
] as const;

export type GoalPriority = (typeof GOAL_PRIORITIES)[number]["id"];
export type GoalEffort = (typeof GOAL_EFFORTS)[number]["id"];

export const effortLabel = (goal: Pick<Goal, "priority" | "effort">) =>
  goal.priority === "A"
    ? "Perform, 100 %"
    : (GOAL_EFFORTS.find((effort) => effort.id === goal.effort)?.label ?? "");

export const goalWeightLabel = (goal: Pick<Goal, "priority" | "effort">) =>
  goal.priority === "A"
    ? "Main"
    : ({ fun: "Fun", steady: "Steady", allOut: "All out" } as const)[goal.effort ?? "steady"];

export function currentGoalWeight(goal: { priority?: unknown; effort?: unknown }) {
  if (goal.priority === "C") return { priority: "B", effort: "fun" };
  if (goal.priority === "B" && goal.effort == null) return { priority: "B", effort: "steady" };
  return { priority: goal.priority, effort: goal.effort };
}

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date." });

const goalFieldsSchema = z.object({
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
  priority: z.enum(["A", "B"]).default("A"),
  effort: z.enum(["fun", "steady", "allOut"]).nullable().default(null),
});

const effortFitsPriority = (goal: { priority: GoalPriority; effort: GoalEffort | null }) =>
  (goal.priority === "B") === (goal.effort != null);
const effortMissing = { error: "Choose how hard you'll race it.", path: ["effort"] };

export const goalInputSchema = goalFieldsSchema.refine(effortFitsPriority, effortMissing);
export const goalUpdateSchema = goalFieldsSchema
  .extend({ id: z.string() })
  .refine(effortFitsPriority, effortMissing);

export type GoalInput = z.input<typeof goalInputSchema>;

export const seasonCopySchema = z.object({
  vo2Season: z.literal(1),
  goals: z
    .array(
      z.preprocess(
        (goal) =>
          goal && typeof goal === "object" ? { ...goal, ...currentGoalWeight(goal) } : goal,
        goalInputSchema,
      ),
    )
    .min(1)
    .max(500),
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
      effort: goal.effort,
    })),
  };
}

const goalKey = (goal: Pick<Goal, "name" | "sportType" | "date">) =>
  `${goal.date}|${goal.sportType}|${goal.name.trim().toLowerCase()}`;

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

export type SeasonEvent = { date: string; goals: Goal[] };

export type PastGoal = Goal & { activityId: string | null };

export type SeasonData = {
  signedIn: boolean;
  sportTypes: string[];
  today: string;
  upcoming: SeasonEvent[];
  past: PastGoal[];
  vdot?: number | null;
};

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

const ROUGH_KMH = { cycling: 25, running: 10, swimming: 3, walking: 5 } as const;
const OTHER_KMH = 10;
const CLIMB_M_PER_HOUR = { cycling: 1000, running: 600, swimming: Infinity, walking: 400 } as const;

export function roughGoalHours(goal: Pick<Goal, "sportType" | "distanceM" | "elevationGainM">) {
  if (goal.distanceM == null) return 0;
  const group = sportGroupFor(goal.sportType)?.id;
  const flat = goal.distanceM / 1000 / (group ? ROUGH_KMH[group] : OTHER_KMH);
  const climb = group ? (goal.elevationGainM ?? 0) / CLIMB_M_PER_HOUR[group] : 0;
  return flat + climb;
}

const LEG_ORDER = ["swimming", "cycling", "running", "walking"];

function legRank(goal: Goal) {
  const index = LEG_ORDER.indexOf(sportGroupFor(goal.sportType)?.id ?? "");
  return index < 0 ? LEG_ORDER.length : index;
}

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

const EFFORT_RANK: Record<GoalEffort, number> = { fun: 0, steady: 1, allOut: 2 };

export function eventPriority(event: SeasonEvent): GoalPriority {
  return event.goals.some((goal) => goal.priority === "A") ? "A" : "B";
}

export function eventEffort(event: SeasonEvent): GoalEffort | null {
  if (eventPriority(event) === "A") return null;
  return event.goals.reduce<GoalEffort>(
    (hardest, goal) =>
      goal.effort && EFFORT_RANK[goal.effort] > EFFORT_RANK[hardest] ? goal.effort : hardest,
    "fun",
  );
}

export const LEG_SEPARATOR = " · ";

export function eventTitle(event: SeasonEvent) {
  const bases = [...new Set(event.goals.map((goal) => goal.name.split(LEG_SEPARATOR)[0]!.trim()))];
  return bases.join(" + ");
}

export function otherLegs<T extends Pick<Goal, "id" | "name" | "date">>(goal: T, all: T[]) {
  const base = goal.name.split(LEG_SEPARATOR)[0]!.trim();
  return all.filter(
    (other) =>
      other.id !== goal.id &&
      other.date === goal.date &&
      other.name.split(LEG_SEPARATOR)[0]!.trim() === base,
  );
}

export function legLabel(goal: Goal, event: SeasonEvent) {
  if (event.goals.length < 2) return null;
  const [, leg] = goal.name.split(LEG_SEPARATOR);
  return leg?.trim() || null;
}

export function anchorEvent(events: SeasonEvent[]): SeasonEvent | null {
  return events.find((event) => eventPriority(event) === "A") ?? null;
}
