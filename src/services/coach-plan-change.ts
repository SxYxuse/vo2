import { z } from "zod";

import {
  briefSchema,
  MAX_BRIEF_LENGTH,
  writtenSessionSchema,
  type PlanSport,
  type SessionKind,
} from "./coach-plan.types.ts";

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
            "The session after the change, in the coach plan's session format, or null to drop the session. A session changed keeps its week and sport.",
          ),
      }),
    )
    .min(1)
    .max(14)
    .describe(
      "Only the sessions that change. Replace one: its id and the session after. Drop one: its id and null. Add one to a week: null and the session.",
    ),
});

export type PlanChangeInput = z.infer<typeof planChangeInputSchema>;

/** A session as the athlete sees it in the change, or null when there is none. */
export type ChangeSide = {
  title: string;
  sport: PlanSport;
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

/**
 * A brief change (ADR 0065): the whole new coach brief, offered with the brief it replaces. It is
 * saved only when the athlete taps Apply, and only if the brief is still the one shown.
 */
export const briefChangeInputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(200)
    .describe("One plain sentence for the athlete: what changes in their brief and why."),
  before: z
    .string()
    .max(MAX_BRIEF_LENGTH)
    .describe(`The athlete's brief now, exactly as get_coach_plan gave it ("" for none).`),
  brief: briefSchema.describe(
    `The whole brief after the change, at most ${MAX_BRIEF_LENGTH} characters: the athlete's standing context in their own voice, such as "Fridays: 30 min at most". "" clears it.`,
  ),
});

export type BriefChangeInput = z.infer<typeof briefChangeInputSchema>;

/** What apply_plan_change answers once the athlete tapped Apply. */
export type PlanChangeApplied = { applied: true } | { applied: false; reason: string };
