import { PHASES, mondayOf, seasonPhase, type SeasonPhase } from "./season-phase.ts";
import { anchorEvent, eventTitle, seasonEvents, type Goal } from "./season.types.ts";
import { addDayKey, keySessionCountFor } from "./training-plan.types.ts";

// A season change (ADR 0026): the plan reads its phases from its own copy of the goals. When
// Season differs, this says which weeks of the current block it would reshape.

/** Days from the leading goal's Monday to the end of its block: its week and the recovery week. */
const BLOCK_TAIL_DAYS = 13;
/** Without a leading goal on either side, how far ahead a change can matter. */
const HOLD_HORIZON_WEEKS = 6;
/** Goals this close to a week still shape its days (lighter days before, easy days after). */
const AROUND_DAYS = 5;

export type WeekChange = {
  weekStart: string;
  before: string;
  after: string;
};

export type PlanImpact = {
  /** The plan's goals and Season's differ at all. */
  differs: boolean;
  /** Weeks before the end of the current block that the change reshapes, in order. */
  changes: WeekChange[];
  /** Goals on Season the plan does not have, has differently, or no longer has. */
  added: Goal[];
  edited: Goal[];
  removed: Goal[];
};

function fingerprint(goal: Goal) {
  return [
    goal.id,
    goal.name,
    goal.date,
    goal.sportType,
    goal.priority,
    goal.objective,
    goal.distanceM ?? "",
    goal.elevationGainM ?? "",
  ].join("|");
}

/** The last day of the block the plan is in: the leading goal and its recovery week. */
export function blockEnd(goals: Goal[], weekStart: string): string | null {
  const ahead = seasonEvents(goals).filter((event) => event.date >= weekStart);
  const anchor = anchorEvent(ahead);
  return anchor ? addDayKey(mondayOf(anchor.date), BLOCK_TAIL_DAYS) : null;
}

function goalsAround(goals: Goal[], weekStart: string) {
  const from = addDayKey(weekStart, -AROUND_DAYS);
  const to = addDayKey(weekStart, 6 + AROUND_DAYS);
  return goals.filter((goal) => goal.date >= from && goal.date <= to);
}

/** What of a week's phase reaches its days; a recovery or hold week ignores the goal ahead. */
function signature(phase: SeasonPhase, around: Goal[], trainingDays: number) {
  const building = phase.kind !== "recovery" && phase.kind !== "hold";
  return JSON.stringify({
    kind: phase.kind,
    lighter: phase.lighter,
    anchor: building ? phase.anchor.map(fingerprint).sort() : null,
    keys: keyCount(phase, trainingDays),
    loadFactor: phase.loadFactor,
    ramp: phase.ramp,
    shares:
      phase.goalShares && phase.goalWeight > 0
        ? Object.values(phase.goalShares).map((share) => Math.round(share * 10))
        : null,
    around: around.map(fingerprint).sort(),
  });
}

function keyCount(phase: SeasonPhase, trainingDays: number) {
  return keySessionCountFor({
    objective: phase.anchor.length ? phase.objective : null,
    phaseMax: phase.maxKeySessions,
    trainingDays,
  });
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A week in words: its phase, key sessions, and the goals in it. */
export function weekLabel(
  phase: SeasonPhase,
  around: Goal[],
  weekStart: string,
  trainingDays: number,
) {
  const parts = [PHASES[phase.kind].label + (phase.lighter ? " (lighter)" : "")];
  const keys = keyCount(phase, trainingDays);
  parts.push(keys ? plural(keys, "key session") : "no key sessions");
  const inWeek = seasonEvents(
    around.filter((goal) => goal.date >= weekStart && goal.date <= addDayKey(weekStart, 6)),
  );
  for (const event of inWeek) {
    parts.push(`${eventTitle(event)} (${event.goals[0]!.priority})`);
  }
  return parts.join(" · ");
}

/**
 * Compares the plan's goals with Season from this week through the end of the current block
 * (the later of the two). A goal well after the leading one changes no week here, so it can go
 * into the plan without asking.
 */
export function planImpact(
  planGoals: Goal[],
  seasonGoals: Goal[],
  weekStart: string,
  trainingDays: number,
): PlanImpact {
  const before = new Map(planGoals.map((goal) => [goal.id, goal]));
  const after = new Map(seasonGoals.map((goal) => [goal.id, goal]));
  const added = seasonGoals.filter((goal) => !before.has(goal.id));
  const removed = planGoals.filter((goal) => !after.has(goal.id));
  const edited = seasonGoals.filter((goal) => {
    const old = before.get(goal.id);
    return old != null && fingerprint(old) !== fingerprint(goal);
  });
  const differs = added.length + removed.length + edited.length > 0;
  if (!differs) return { differs, changes: [], added, edited, removed };

  const ends = [blockEnd(planGoals, weekStart), blockEnd(seasonGoals, weekStart)].filter(
    (end): end is string => end != null,
  );
  const end = ends.length ? ends.sort().at(-1)! : addDayKey(weekStart, 7 * HOLD_HORIZON_WEEKS - 1);
  const changes: WeekChange[] = [];
  for (let week = weekStart; week <= mondayOf(end); week = addDayKey(week, 7)) {
    const oldPhase = seasonPhase(planGoals, week);
    const newPhase = seasonPhase(seasonGoals, week);
    const oldAround = goalsAround(planGoals, week);
    const newAround = goalsAround(seasonGoals, week);
    if (
      signature(oldPhase, oldAround, trainingDays) === signature(newPhase, newAround, trainingDays)
    ) {
      continue;
    }
    const was = weekLabel(oldPhase, oldAround, week, trainingDays);
    const now = weekLabel(newPhase, newAround, week, trainingDays);
    changes.push({
      weekStart: week,
      before: was,
      after: now === was ? `${now} · different sessions` : now,
    });
  }
  return { differs, changes, added, edited, removed };
}

/** What changes for the athlete when a season change goes into the plan without asking. */
export function adoptedNote(seasonGoals: Goal[], weekStart: string) {
  const ahead = seasonEvents(seasonGoals).filter((event) => event.date >= weekStart);
  const anchor = anchorEvent(ahead);
  return anchor
    ? `Nothing changes before ${eventTitle(anchor)}.`
    : "Nothing changes in the coming weeks.";
}

export { mondayOf };
