import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import type { z } from "zod";

import { env } from "@/configs/env.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { logger } from "@/lib/logger.server.ts";
import { ANALYSIS_MODEL } from "./activity-analysis.server.ts";
import {
  acceptProposals,
  applyPlacementReview,
  MAX_AI_SIMILAR,
  placementReviewSchema,
  proposalsSchema,
  similarPicksSchema,
  validateSimilarPicks,
} from "./fuel-ai.ts";
import type { FuelPlan, FuelPlanInput, ProposalSpec } from "./fuel-plan.ts";
import type { RoutePrediction, SimilarActivity } from "./route-prediction.ts";

const SYSTEM_PROMPT = `You are an endurance coach planning fuel for one route. Every number you see comes from the athlete's data or the MNSTRY store. Never invent products, carbs, or caffeine. Answer only with the requested JSON.`;

/** The coach model, or null without an API key: the planner then keeps its own results. */
function adapter() {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createOpenRouterText(ANALYSIS_MODEL, apiKey, {
    httpReferer: env.BETTER_AUTH_URL,
    appTitle: APP_NAME,
  });
}

async function ask<T extends z.ZodType>(task: string, prompt: unknown, schema: T) {
  const model = adapter();
  if (!model) return null;
  try {
    return (await chat({
      adapter: model,
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: "user", content: JSON.stringify(prompt) }],
      outputSchema: schema,
    })) as z.infer<T>;
  } catch (error) {
    logger.warn("fuel_ai.failed", { task, error: String(error) });
    return null;
  }
}

function routeSummary(prediction: RoutePrediction) {
  return {
    sportType: prediction.sportType,
    distanceKm: Math.round(prediction.distanceM / 100) / 10,
    gainM: prediction.gainM,
    predictedMinutes: Math.round(prediction.elapsedSec / 60),
    climbs: prediction.climbs.map((climb) => ({
      startKm: climb.startKm,
      startMinute: Math.round(climb.startSec / 60),
      minutes: Math.round(climb.durationSec / 60),
      gainM: climb.gainM,
      avgGradePct: climb.avgGradePct,
    })),
  };
}

/** Lets the model pick and weight comparable activities among the scored candidates. */
export async function chooseSimilarActivities(
  route: { sportType: string; distanceM: number; gainM: number },
  candidates: SimilarActivity[],
) {
  if (candidates.length <= 1) return null;
  const raw = await ask(
    "similar",
    {
      task: `Pick up to ${MAX_AI_SIMILAR} past activities most like this route for predicting its pace. Weight 0-1 by how alike they are (distance, climbing, how recent). Use only these ids.`,
      route: {
        sportType: route.sportType,
        distanceKm: route.distanceM / 1000,
        gainM: route.gainM,
      },
      candidates: candidates.slice(0, 15).map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        date: candidate.startDate.slice(0, 10),
        distanceKm: Math.round(candidate.distanceM / 100) / 10,
        gainM: Math.round(candidate.gainM),
        minutes: Math.round(candidate.movingSec / 60),
      })),
    },
    similarPicksSchema,
  );
  const picks = raw ? validateSimilarPicks(raw, candidates) : null;
  logger.info("fuel_ai.similar", { asked: raw != null, accepted: picks != null });
  return picks;
}

/** Up to three proposals from the model, checked and topped up with the default ones. */
export async function proposeFuelPlans(
  input: FuelPlanInput,
  prediction: RoutePrediction,
  fallback: ProposalSpec[],
) {
  const raw = await ask(
    "proposals",
    {
      task: "Propose 3 fuel plans that clearly differ: one balanced, one leaning on the drink (drinkShare 0.5 or more), one leaning on solid food (solidShare 0.3 or more), and use different products where the athlete has them. Each must name a drink mix (SLOW CARB, FAST CARB or POWER CARB when the athlete has them), one solid (a JELLY 40 or a bar — bars only on rides over 2 h), the athlete's plain gels (up to 3, so flavours rotate), an optional caffeine product for the last climb, and the share of carbs the drink and solid should cover. Never omit the drink or the solid. The drink is sipped every 15-20 minutes. The planner computes servings and timing.",
      route: routeSummary(prediction),
      carbTargetPerHour: input.carbTarget,
      bottles: input.bottles,
      bodyWeightKg: input.bodyWeightKg,
      products: input.products.map((product) => ({
        id: product.id,
        name: product.name,
        kind: product.kind,
        carbsG: product.carbsG,
        serving: product.serving?.label ?? null,
        mixMl: product.serving?.mixMl ?? null,
        glucoseFructose: product.glucoseFructose,
        caffeineMg: product.caffeineMg,
      })),
    },
    proposalsSchema,
  );
  const proposals = raw ? acceptProposals(raw, input, fallback) : fallback;
  logger.info("fuel_ai.proposals", {
    asked: raw != null,
    fromModel: proposals.filter((proposal) => proposal.id.startsWith("coach-")).length,
  });
  return proposals;
}

/** Lets the model nudge intakes around the climbs; kept only if every rule still holds. */
export async function reviewPlacement(
  input: FuelPlanInput,
  prediction: RoutePrediction,
  plan: FuelPlan,
) {
  const raw = await ask(
    "placement",
    {
      task: "Review this intake timeline. You may move intakes by up to 10 minutes (shiftMin) where the terrain or a climb makes another moment better, with a short reason for the athlete. Return an empty list if it is already good.",
      route: routeSummary(prediction),
      // Sips are spread evenly and aren't moved; indexes stay those of the full list.
      intakes: plan.intakes.flatMap((intake, index) =>
        intake.role === "drink"
          ? []
          : [
              {
                index,
                minute: Math.round(intake.atSec / 60),
                km: intake.km,
                role: intake.role,
                productId: intake.productId,
                carbsG: intake.carbsG,
                readyAtMinute: Math.round(intake.readyAtSec / 60),
                reason: intake.reason,
              },
            ],
      ),
    },
    placementReviewSchema,
  );
  if (!raw) return plan;
  const reviewed = applyPlacementReview(input, plan, raw);
  logger.info("fuel_ai.placement", { shifts: raw.shifts.length, kept: reviewed !== plan });
  return reviewed;
}
