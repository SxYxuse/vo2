import { byokMissing } from "@tanstack/ai/byok";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

import { env } from "@/configs/env.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { coachModelsFor } from "./athlete-settings.server.ts";
import { coachKeyFor } from "./coach-key.server.ts";
import { OPENROUTER, type CoachFeature } from "./coach-models.ts";

/** The ids the adapter's types list; it sends any OpenRouter id as given. */
type ListedModel = Parameters<typeof createOpenRouterText>[0];

export type CoachModel =
  | {
      kind: "openrouter";
      model: string;
      adapter: ReturnType<typeof createOpenRouterText>;
      /** For scrubbing it out of anything logged. */
      key: string;
    }
  | { kind: "mock"; model: "mock" }
  | { kind: "missing" };

/**
 * The model a coach feature runs on for this athlete. Only the athlete's own key, saved with their
 * account, runs one: VO2 keeps no key of its own (ADR 0036). Under mock Strava the mock coach
 * answers when no key is saved, so development, CI, and the e2e suite need none.
 */
export async function coachModelFor(userId: string, feature: CoachFeature): Promise<CoachModel> {
  const [key, models] = await Promise.all([coachKeyFor(userId), coachModelsFor(userId)]);
  if (!key) return env.STRAVA_MOCK ? { kind: "mock", model: "mock" } : { kind: "missing" };
  const model = models[feature];
  // The stored id is a plain string: a model dropped from the curated list keeps running until
  // the athlete picks another. The adapter's types name only the ids it lists, hence the cast.
  const adapter = createOpenRouterText(model as ListedModel, key, {
    httpReferer: env.BETTER_AUTH_URL,
    appTitle: APP_NAME,
  });
  return { kind: "openrouter", model, adapter, key };
}

/** The 401 the client reads as "add your OpenRouter key". */
export function coachKeyMissing() {
  return byokMissing(OPENROUTER);
}

/** Whether coach features answer without a key: only the mock coach does. */
export function isCoachMocked() {
  return env.STRAVA_MOCK;
}
