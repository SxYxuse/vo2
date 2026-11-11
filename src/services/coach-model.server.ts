import type { ReasoningLevel } from "@tanstack/ai";
import { byokMissing } from "@tanstack/ai/byok";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

import { env } from "@/configs/env.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { coachModelsFor } from "./athlete-settings.server.ts";
import { coachKeyFor } from "./coach-key.server.ts";
import type { CoachFeature, CoachModelChoice, CoachProvider } from "./coach-models.ts";

/** The ids the adapters' types list; each sends any id as given. */
type ListedOpenRouterModel = Parameters<typeof createOpenRouterText>[0];
type ListedOpenAIModel = Parameters<typeof createOpenaiChat>[0];

/**
 * The stored id is a plain string: a model dropped from the curated list keeps running until the
 * athlete picks another. The adapters' types name only the ids they list, hence the casts.
 */
export function textAdapter({ provider, model }: CoachModelChoice, key: string) {
  switch (provider) {
    case "openai":
      return createOpenaiChat(model as ListedOpenAIModel, key);
    case "openrouter":
      return createOpenRouterText(model as ListedOpenRouterModel, key, {
        httpReferer: env.BETTER_AUTH_URL,
        appTitle: APP_NAME,
      });
  }
}

export type CoachModel =
  | {
      kind: "live";
      provider: CoachProvider;
      model: string;
      adapter: ReturnType<typeof textAdapter>;
      /** Undefined: send no level, so the provider's default applies. */
      reasoning: ReasoningLevel | undefined;
      /** For scrubbing it out of anything logged. */
      key: string;
    }
  | { kind: "mock"; model: "mock" }
  | { kind: "missing"; provider: CoachProvider };

/**
 * The model a coach feature runs on for this athlete. Only the athlete's own key for the model's
 * provider, saved with their account, runs one: VO2 keeps no key of its own (ADR 0036, ADR 0059).
 * Under mock Strava the mock coach answers when that key is missing, so development, CI, and the
 * e2e suite need none.
 */
export async function coachModelFor(userId: string, feature: CoachFeature): Promise<CoachModel> {
  const choice = (await coachModelsFor(userId))[feature];
  const key = await coachKeyFor(userId, choice.provider);
  if (!key) {
    return env.STRAVA_MOCK
      ? { kind: "mock", model: "mock" }
      : { kind: "missing", provider: choice.provider };
  }
  return {
    kind: "live",
    provider: choice.provider,
    model: choice.model,
    adapter: textAdapter(choice, key),
    reasoning: choice.reasoning ?? undefined,
    key,
  };
}

/** The 401 the client reads as "add your key for this provider". */
export function coachKeyMissing(provider: CoachProvider) {
  return byokMissing(provider);
}

/** Whether coach features answer without a key: only the mock coach does. */
export function isCoachMocked() {
  return env.STRAVA_MOCK;
}
