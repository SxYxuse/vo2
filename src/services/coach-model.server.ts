import type { ReasoningLevel } from "@tanstack/ai";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

import { env } from "@/configs/env.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { coachModelsFor } from "./athlete-settings.server.ts";
import { coachKeyFor } from "./coach-key.server.ts";
import type { CoachFeature, CoachModelChoice, CoachProvider } from "./coach-models.ts";

type ListedOpenRouterModel = Parameters<typeof createOpenRouterText>[0];
type ListedOpenAIModel = Parameters<typeof createOpenaiChat>[0];

/**
 * The stored id is a plain string: a model dropped from the curated list keeps running until the
 * athlete picks another. The adapters' types name only the ids they list, hence the casts.
 */
function textAdapter({ provider, model }: CoachModelChoice, key: string) {
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
      reasoning: ReasoningLevel | undefined;
      key: string;
    }
  | { kind: "mock"; provider: CoachProvider; model: "mock" }
  | { kind: "missing"; provider: CoachProvider };

export async function coachModelFor(userId: string, feature: CoachFeature): Promise<CoachModel> {
  const choice = (await coachModelsFor(userId))[feature];
  const key = await coachKeyFor(userId, choice.provider);
  if (!key) {
    return isCoachMocked()
      ? { kind: "mock", provider: choice.provider, model: "mock" }
      : { kind: "missing", provider: choice.provider };
  }
  return liveCoachModel(choice, key);
}

export function liveCoachModel(
  choice: CoachModelChoice,
  key: string,
): Extract<CoachModel, { kind: "live" }> {
  return {
    kind: "live",
    provider: choice.provider,
    model: choice.model,
    adapter: textAdapter(choice, key),
    reasoning: choice.reasoning ?? undefined,
    key,
  };
}

export function isCoachMocked() {
  return env.STRAVA_MOCK;
}
