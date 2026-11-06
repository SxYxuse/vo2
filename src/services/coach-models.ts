import type { ReasoningLevel } from "@tanstack/ai";
import { z } from "zod";

/**
 * The providers an athlete can add a key for (ADR 0059). Each id is also TanStack AI's BYOK
 * provider id, so a missing key names the provider the model needs.
 */
export const COACH_PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "One key for models from every lab.",
    keysUrl: "https://openrouter.ai/settings/keys",
    keysSite: "openrouter.ai",
    placeholder: "sk-or-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT models, billed to your OpenAI account.",
    keysUrl: "https://platform.openai.com/api-keys",
    keysSite: "platform.openai.com",
    placeholder: "sk-…",
  },
] as const;

export type CoachProvider = (typeof COACH_PROVIDERS)[number]["id"];

export const OPENROUTER: CoachProvider = "openrouter";

export const COACH_PROVIDER_IDS = COACH_PROVIDERS.map((provider) => provider.id) as [
  CoachProvider,
  ...CoachProvider[],
];

export function coachProviderLabel(id: CoachProvider) {
  return COACH_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

/** The things the coach does that need a model (ADR 0036). */
export const COACH_FEATURES = [
  {
    id: "chat",
    label: "Coach chat",
    hint: "Answers your questions about your training.",
  },
  {
    id: "plan",
    label: "Plan writing",
    hint: "Writes the coach plan's rides and runs, four weeks ahead.",
  },
] as const;

export type CoachFeature = (typeof COACH_FEATURES)[number]["id"];

/** Every level TanStack AI knows, least thinking first. */
export const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ReasoningLevel[];

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const NONE_LOW_TO_MAX: ReasoningLevel[] = ["off", "low", "medium", "high", "xhigh", "max"];
const LOW_TO_MAX: ReasoningLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Curated, not a provider's whole catalog: each one is checked to support tool calls (chat) and
 * structured JSON output (plan writing), so any of them runs every coach feature.
 *
 * `reasoning` lists the levels the athlete can pick, copied from the adapter's model data. The
 * adapter clamps the level it is sent to the model's own, so a list that falls behind only offers
 * a level that runs as its nearest neighbour.
 */
export const COACH_MODELS = [
  {
    provider: "openrouter",
    id: "openai/gpt-6-luna",
    label: "GPT-6 Luna",
    hint: "OpenAI · quick and cheap",
    reasoning: NONE_LOW_TO_MAX,
  },
  {
    provider: "openrouter",
    id: "openai/gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    hint: "OpenAI · balanced",
    reasoning: [],
  },
  {
    provider: "openrouter",
    id: "openai/gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    hint: "OpenAI · strong",
    reasoning: LOW_TO_MAX,
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5",
    hint: "Anthropic · quick and cheap",
    reasoning: ["off", "high"],
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-sonnet-5.5",
    label: "Claude Sonnet 5.5",
    hint: "Anthropic · strong",
    reasoning: LOW_TO_MAX,
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-opus-5.5",
    label: "Claude Opus 5.5",
    hint: "Anthropic · strongest",
    reasoning: LOW_TO_MAX,
  },
  {
    provider: "openrouter",
    id: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    hint: "Z.ai · quick and cheap",
    reasoning: ["low", "high", "max"],
  },
  {
    provider: "openrouter",
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    hint: "DeepSeek · cheapest",
    reasoning: ["off", "low", "high", "max"],
  },
  {
    provider: "openrouter",
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    hint: "Google · balanced",
    reasoning: ["low", "medium", "high"],
  },
  {
    provider: "openai",
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    hint: "OpenAI · quick and cheap",
    reasoning: NONE_LOW_TO_MAX,
  },
  {
    provider: "openai",
    id: "gpt-6-sol",
    label: "GPT-6 Sol",
    hint: "OpenAI · strong",
    reasoning: NONE_LOW_TO_MAX,
  },
  {
    provider: "openai",
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    hint: "OpenAI · strongest",
    reasoning: LOW_TO_MAX,
  },
] as const satisfies readonly {
  provider: CoachProvider;
  id: string;
  label: string;
  hint: string;
  reasoning: readonly ReasoningLevel[];
}[];

export type CoachModelOption = (typeof COACH_MODELS)[number];

/** The provider default, sent as no reasoning option at all. */
export const AUTO_REASONING = null;

/**
 * Every feature starts here, plan writing too: it rewrites up to four weeks, so a strong default
 * there is the expensive one. A plan model already stored stays (ADR 0036).
 */
export const DEFAULT_COACH_MODEL = {
  provider: "openrouter",
  model: "openai/gpt-6-luna",
  reasoning: AUTO_REASONING,
} as const satisfies CoachModelChoice;

/**
 * Stored as chosen: a model later dropped from the list keeps running and shows as no longer
 * offered until the athlete picks another, rather than switching silently (ADR 0036). Before
 * ADR 0059 a choice was a bare OpenRouter model id.
 */
const coachModelChoiceSchema = z.preprocess(
  (value) => (typeof value === "string" ? { provider: OPENROUTER, model: value } : value),
  z
    .object({
      provider: z.enum(COACH_PROVIDER_IDS),
      model: z.string().min(1),
      reasoning: z.enum(REASONING_LEVELS).nullable().catch(AUTO_REASONING).default(AUTO_REASONING),
    })
    .catch(DEFAULT_COACH_MODEL),
);

export type CoachModelChoice = {
  provider: CoachProvider;
  model: string;
  /** null: send no level, so the provider's default applies. */
  reasoning: ReasoningLevel | null;
};

export const coachModelsSchema = z.object({
  chat: coachModelChoiceSchema.default(DEFAULT_COACH_MODEL),
  plan: coachModelChoiceSchema.default(DEFAULT_COACH_MODEL),
});

export type CoachModels = Record<CoachFeature, CoachModelChoice>;

export const DEFAULT_COACH_MODELS: CoachModels = {
  chat: DEFAULT_COACH_MODEL,
  plan: DEFAULT_COACH_MODEL,
};

export function findCoachModel(provider: CoachProvider, id: string) {
  return COACH_MODELS.find((model) => model.provider === provider && model.id === id);
}

/** A stored choice keeps its id, including models no longer listed. */
export function coachModelLabel(id: string, provider: CoachProvider = OPENROUTER) {
  if (id === "mock") return "Mock coach";
  return findCoachModel(provider, id)?.label ?? id;
}

/**
 * The level to keep when the athlete picks another model: the same one when the model has it,
 * else the nearest above, else the nearest below (TanStack AI's clamp rule). Auto stays Auto.
 */
export function keptReasoning(
  level: ReasoningLevel | null,
  levels: readonly ReasoningLevel[],
): ReasoningLevel | null {
  if (level == null || !levels.length) return AUTO_REASONING;
  if (levels.includes(level)) return level;
  const rank = REASONING_LEVELS.indexOf(level);
  const above = levels.find((each) => REASONING_LEVELS.indexOf(each) > rank);
  return above ?? levels.at(-1) ?? AUTO_REASONING;
}
