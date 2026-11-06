import type { ReasoningLevel } from "@tanstack/ai";
import {
  OPENROUTER_COMBINED_TOOLS_AND_SCHEMA_MODELS,
  OPENROUTER_MODEL_REASONING,
} from "@tanstack/ai-openrouter/model-meta";

import {
  catalogLabel,
  type CoachModelOption,
  type CoachProvider,
  OPENROUTER,
  REASONING_LEVELS,
  RECOMMENDED_MODELS,
} from "./coach-models.ts";

function reasoningOf(id: string): ReasoningLevel[] {
  const reasoning = OPENROUTER_MODEL_REASONING[id];
  if (!reasoning) return [];
  return REASONING_LEVELS.filter((level) => level in reasoning.levels);
}

/**
 * Every model the picker offers (ADR 0060): the recommended ones, then each OpenRouter model whose
 * catalog entry supports tools, tool choice, and structured outputs together, which chat and plan
 * writing need. `:batch` variants are left out: they queue requests, and the coach streams.
 * OpenAI's adapter exports no capability data, so direct OpenAI keys keep the recommended models.
 * Kept on the server: the catalog is a third of a megabyte the installed app need not carry.
 */
const CATALOG: CoachModelOption[] = [
  ...RECOMMENDED_MODELS,
  ...[...OPENROUTER_COMBINED_TOOLS_AND_SCHEMA_MODELS]
    .filter(
      (id) =>
        !id.endsWith(":batch") &&
        !RECOMMENDED_MODELS.some((model) => model.provider === OPENROUTER && model.id === id),
    )
    .sort()
    .map((id) => ({
      provider: OPENROUTER,
      id,
      label: catalogLabel(id),
      hint: id.slice(0, id.indexOf("/")).replace(/^~/, ""),
      reasoning: reasoningOf(id),
      recommended: false,
    })),
];

export function coachCatalog() {
  return CATALOG;
}

export function findOfferedModel(provider: CoachProvider, id: string) {
  return CATALOG.find((model) => model.provider === provider && model.id === id);
}
