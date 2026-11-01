import { z } from "zod";

import { writtenSessionSchema, type SessionKind } from "./coach-plan.types.ts";

/*
 * A plan change (ADR 0038): the coach proposes the days it changes, VO2 checks them against every
 * coach plan rule, and the athlete applies or declines what passed. Shared by the chat tools and
 * the approval card.
 */

const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const planChangeInputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(200)
    .describe("One plain sentence for the athlete: what changes and why."),
  days: z
    .array(
      z.object({
        date: dayKeySchema,
        session: writtenSessionSchema
          .nullable()
          .describe(
            "The run on this day after the change, in the coach plan's session format, or null to make it a rest day.",
          ),
      }),
    )
    .min(1)
    .max(14)
    .describe(
      "Only the days that change. A move is two days: the old one set to null, the new one with the run.",
    ),
});

export type PlanChangeInput = z.infer<typeof planChangeInputSchema>;

/** A day's run as the athlete sees it in the change, or null for a rest day. */
export type ChangeSide = {
  title: string;
  kind: SessionKind;
  key: boolean;
  distanceKm: number;
  minutes: number;
  /** One line per block, so a change of steps under the same title shows. */
  steps: string[];
} | null;

export type ChangedDay = { date: string; before: ChangeSide; after: ChangeSide };

/** What propose_plan_change answers: a checked change to apply, or why it can't be offered. */
export type PlanChangeProposal =
  | { ok: true; proposalId: string; summary: string; days: ChangedDay[] }
  | { ok: false; broken: string[] };

/** What apply_plan_change answers once the athlete tapped Apply. */
export type PlanChangeApplied = { applied: true } | { applied: false; reason: string };

/** The quick choices of a day note on the coach plan (GLOSSARY: Coach note). */
export const DAY_NOTE_CHOICES = [
  { id: "cant", label: "Can't train", text: "I can't train that day." },
  { id: "short", label: "Short on time", text: "I'm short on time that day." },
  { id: "indoor", label: "Indoor only", text: "I can only run indoors that day." },
  { id: "easy", label: "Take it easy", text: "I need to take it easy that day." },
] as const;

/** The message a day note sends to the coach: the day, then the athlete's note. */
export function dayNoteMessage(date: string, weekday: string, note: string) {
  return `Note on my plan for ${weekday} ${date}: ${note.trim()} Please propose a change to my plan for it.`;
}
