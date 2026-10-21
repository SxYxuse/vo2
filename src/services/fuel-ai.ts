import { z } from "zod";

import { isPlannable, type FuelProduct } from "./fuel-catalog.ts";
import {
  checkPlan,
  rolesFor,
  solveFuelPlan,
  terrainAllows,
  withGelVariety,
  type FuelPlan,
  type FuelPlanInput,
  type FuelRole,
  type ProposalSpec,
} from "./fuel-plan.ts";
import type { SimilarActivity } from "./route-prediction.ts";

// The coach model never outputs grams or times of its own: it picks ids, shares and small
// shifts, and each answer is checked here. Anything that fails keeps the deterministic result.

export const MAX_AI_SIMILAR = 5;
const MAX_SHIFT_MIN = 10;

export const similarPicksSchema = z.object({
  picks: z
    .array(
      z.object({
        id: z.string(),
        weight: z.number().min(0).max(1),
        reason: z.string(),
      }),
    )
    .max(MAX_AI_SIMILAR),
});

export const proposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        rationale: z.string().min(1).max(240),
        drinkId: z.string().nullable(),
        drinkShare: z.number().min(0).max(1),
        gelIds: z.array(z.string()).min(1).max(3),
        solidId: z.string().nullable(),
        solidShare: z.number().min(0).max(0.5),
        caffeineId: z.string().nullable(),
      }),
    )
    .min(1)
    .max(3),
});

export const placementReviewSchema = z.object({
  shifts: z.array(
    z.object({
      index: z.number().int().min(0),
      shiftMin: z.number().int().min(-MAX_SHIFT_MIN).max(MAX_SHIFT_MIN),
      reason: z.string().max(160),
    }),
  ),
});

/** Similar activities the model chose, kept only if every id was offered. */
export function validateSimilarPicks(
  raw: z.infer<typeof similarPicksSchema>,
  candidates: SimilarActivity[],
): { id: string; weight: number }[] | null {
  const offered = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  for (const pick of raw.picks) {
    if (!offered.has(pick.id) || seen.has(pick.id)) return null;
    seen.add(pick.id);
  }
  const picks = raw.picks.filter((pick) => pick.weight > 0);
  return picks.length > 0 ? picks.map(({ id, weight }) => ({ id, weight })) : null;
}

function fits(product: FuelProduct | undefined, role: FuelRole) {
  return product != null && isPlannable(product) && rolesFor(product).includes(role);
}

/**
 * Keeps the model's proposals whose products exist, have stated carbs, sit in the right role,
 * and solve into a plan that breaks no rule; tops up with the deterministic ones to three.
 */
export function acceptProposals(
  raw: z.infer<typeof proposalsSchema>,
  input: FuelPlanInput,
  fallback: ProposalSpec[],
): ProposalSpec[] {
  const byId = new Map(input.products.map((product) => [product.id, product]));
  const accepted: ProposalSpec[] = [];
  const mixes = new Set<string>();
  for (const [index, proposal] of raw.proposals.entries()) {
    const solid = proposal.solidId ? byId.get(proposal.solidId) : undefined;
    const valid =
      proposal.drinkId != null &&
      fits(byId.get(proposal.drinkId), "drink") &&
      proposal.solidId != null &&
      (fits(solid, "bar") || fits(solid, "jelly")) &&
      (proposal.caffeineId == null || fits(byId.get(proposal.caffeineId), "caffeine")) &&
      proposal.gelIds.length > 0 &&
      proposal.gelIds.every((id) => fits(byId.get(id), "gel"));
    if (!valid) continue;
    const spec = withGelVariety({ id: `coach-${index + 1}`, ...proposal }, input.products);
    const mix = [spec.drinkId, spec.solidId, spec.caffeineId, ...spec.gelIds].join(",");
    if (mixes.has(mix)) continue;
    if (solveFuelPlan(input, spec).issues.length > 0) continue;
    mixes.add(mix);
    accepted.push(spec);
  }
  for (const spec of fallback) {
    if (accepted.length >= 3) break;
    const mix = [spec.drinkId, spec.solidId, spec.caffeineId, ...spec.gelIds].join(",");
    if (mixes.has(mix)) continue;
    mixes.add(mix);
    accepted.push(spec);
  }
  return accepted;
}

/** Indexes of the climbs that have food absorbed in the 20 minutes before they start. */
function fuelledClimbs(input: FuelPlanInput, intakes: FuelPlan["intakes"]) {
  return input.climbs.flatMap((climb, index) =>
    intakes.some(
      (intake) =>
        intake.role !== "drink" &&
        intake.readyAtSec <= climb.startSec &&
        intake.readyAtSec >= climb.startSec - 20 * 60,
    )
      ? [index]
      : [],
  );
}

/**
 * Applies the model's small moves (±10 min) and keeps them only when the plan still holds:
 * same rules, each climb still fuelled, no bar on a climb, times inside the intake window.
 */
export function applyPlacementReview(
  input: FuelPlanInput,
  plan: FuelPlan,
  raw: z.infer<typeof placementReviewSchema>,
): FuelPlan {
  if (raw.shifts.length === 0) return plan;
  const first = Math.min(...plan.intakes.map((intake) => intake.earliestSec));
  const last = Math.max(...plan.intakes.map((intake) => intake.latestSec));
  const moved = plan.intakes.map((intake) => ({ ...intake }));
  for (const shift of raw.shifts) {
    const intake = moved[shift.index];
    if (!intake) return plan;
    const delta = shift.shiftMin * 60;
    const atSec = intake.atSec + delta;
    if (atSec < first || atSec > last) return plan;
    intake.atSec = atSec;
    intake.earliestSec = Math.max(first, intake.earliestSec + delta);
    intake.latestSec = Math.min(last, intake.latestSec + delta);
    intake.readyAtSec += delta;
    const reason = shift.reason.trim().replace(/\.$/, "");
    // Reasons read as a clause after the carbs: "40 g carbs · keeps carbs steady".
    if (reason) intake.reason = reason.charAt(0).toLowerCase() + reason.slice(1);
    if (!terrainAllows(input, intake.role, atSec)) return plan;
  }
  moved.sort((a, b) => a.atSec - b.atSec);
  const next: FuelPlan = { ...plan, intakes: moved, issues: [] };
  const issues = checkPlan(input, next);
  const fuelled = new Set(fuelledClimbs(input, moved));
  const lostClimb = fuelledClimbs(input, plan.intakes).some((index) => !fuelled.has(index));
  if (issues.length > plan.issues.length || lostClimb) return plan;
  return { ...next, issues };
}
