import { z } from "zod";

import {
  briefSchema,
  MAX_BRIEF_LENGTH,
  writtenSessionSchema,
  type PlanSport,
  type SessionKind,
} from "./coach-plan.types.ts";

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

export type ChangeSide = {
  title: string;
  sport: PlanSport;
  kind: SessionKind;
  distanceKm: number;
  minutes: number;
  steps: string[];
} | null;

export type ChangedSession = { weekStart: string; before: ChangeSide; after: ChangeSide };

export type PlanChangeProposal =
  | { ok: true; proposalId: string; summary: string; sessions: ChangedSession[] }
  | { ok: false; broken: string[] };

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

export type PlanChangeApplied = { applied: true } | { applied: false; reason: string };
