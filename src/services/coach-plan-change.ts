import { z } from "zod";

import { writtenSessionSchema, type SessionKind } from "./coach-plan.types.ts";

/*
 * A plan change (ADR 0038): the coach proposes the sessions it changes, VO2 checks them against
 * every coach plan rule, and the athlete applies or declines what passed. Sessions have no day
 * (ADR 0048), so a change replaces, drops, or adds a week's session. Shared by the chat tools and
 * the approval card.
 */

export const planChangeInputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(200)
    .describe("One plain sentence for the athlete: what changes and why."),
  sessions: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(64)
          .nullable()
          .describe("The id of the session that changes, from get_coach_plan, or null to add one."),
        session: writtenSessionSchema
          .nullable()
          .describe(
            "The run after the change, in the coach plan's session format, or null to drop the session. A session changed keeps its week.",
          ),
      }),
    )
    .min(1)
    .max(14)
    .describe(
      "Only the sessions that change. Replace one: its id and the run after. Drop one: its id and null. Add one to a week: null and the run.",
    ),
});

export type PlanChangeInput = z.infer<typeof planChangeInputSchema>;

/** A session as the athlete sees it in the change, or null when there is none. */
export type ChangeSide = {
  title: string;
  kind: SessionKind;
  distanceKm: number;
  minutes: number;
  /** One line per block, so a change of steps under the same title shows. */
  steps: string[];
} | null;

/** One session of the change, before and after, in its week. */
export type ChangedSession = { weekStart: string; before: ChangeSide; after: ChangeSide };

/** What propose_plan_change answers: a checked change to apply, or why it can't be offered. */
export type PlanChangeProposal =
  | { ok: true; proposalId: string; summary: string; sessions: ChangedSession[] }
  | { ok: false; broken: string[] };

/** What apply_plan_change answers once the athlete tapped Apply. */
export type PlanChangeApplied = { applied: true } | { applied: false; reason: string };

/** The quick choices of a note on a week of the coach plan (GLOSSARY: Coach note). */
export const WEEK_NOTE_CHOICES = [
  { id: "cant", label: "Can't train", text: "I can't train on some days this week." },
  { id: "short", label: "Short on time", text: "I'm short on time this week." },
  { id: "indoor", label: "Indoor only", text: "I can only run indoors this week." },
  { id: "easy", label: "Take it easy", text: "I need to take it easy this week." },
] as const;

/** The message a week note sends to the coach: the week, then the athlete's note. */
export function weekNoteMessage(weekStart: string, note: string) {
  return `Note on my plan for the week of ${weekStart}: ${note.trim()} Please propose a change to that week's sessions.`;
}
