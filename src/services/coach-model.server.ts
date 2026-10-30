import { byokMissing } from "@tanstack/ai/byok";
import { getByokKey } from "@tanstack/ai/byok/server";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

import { env } from "@/configs/env.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { coachModelsFor } from "./athlete-settings.server.ts";
import type { CoachFeature, CoachModelId } from "./coach-models.ts";

/** The BYOK slug: the client sends the key as `x-byok-openrouter`. */
export const OPENROUTER = "openrouter";

export type CoachModel =
  | { kind: "openrouter"; model: string; adapter: ReturnType<typeof createOpenRouterText> }
  | { kind: "mock"; model: "mock" }
  | { kind: "missing" };

/**
 * The model a coach feature runs on for this request. Only the athlete's own key runs one: VO2
 * keeps no server key (ADR 0036). Under mock Strava the mock coach answers instead, so
 * development, CI, and the e2e suite need no key.
 */
export async function coachModelFor(
  request: Request,
  userId: string,
  feature: CoachFeature,
): Promise<CoachModel> {
  const key = getByokKey(request, OPENROUTER);
  if (!key) return env.STRAVA_MOCK ? { kind: "mock", model: "mock" } : { kind: "missing" };
  const model = (await coachModelsFor(userId))[feature];
  // A model dropped from the curated list still runs until the athlete picks another.
  const adapter = createOpenRouterText(model as CoachModelId, key, {
    httpReferer: env.BETTER_AUTH_URL,
    appTitle: APP_NAME,
  });
  return { kind: "openrouter", model, adapter };
}

/** The 401 the client reads as "add your OpenRouter key". */
export function coachKeyMissing() {
  return byokMissing(OPENROUTER);
}

/** Whether coach features answer without a key: only the mock coach does. */
export function isCoachMocked() {
  return env.STRAVA_MOCK;
}
