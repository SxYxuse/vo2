import { z } from "zod";

/** The provider id the athlete's key is stored under (TanStack AI's BYOK provider ids). */
export const OPENROUTER = "openrouter";

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

/**
 * Curated, not OpenRouter's whole catalog: each one is checked to support tool calls (chat) and structured JSON output (plan writing), so any of them runs every coach feature.
 */
export const COACH_MODELS = [
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", hint: "OpenAI · quick and cheap" },
  { id: "openai/gpt-6.1-terra", label: "GPT-6.1 Terra", hint: "OpenAI · balanced" },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", hint: "OpenAI · strong" },
  {
    id: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5",
    hint: "Anthropic · quick and cheap",
  },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", hint: "Anthropic · strong" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", hint: "Anthropic · strongest" },
  { id: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", hint: "Z.ai · quick and cheap" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", hint: "DeepSeek · cheapest" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", hint: "Google · balanced" },
] as const;

export type CoachModelId = (typeof COACH_MODELS)[number]["id"];

/**
 * Every feature starts here, plan writing too: it rewrites up to four weeks, so a strong default
 * there is the expensive one. A plan model already stored stays (ADR 0036).
 */
export const DEFAULT_COACH_MODEL: CoachModelId = "openai/gpt-6-luna";

/**
 * Stored as chosen: a model later dropped from the list keeps running and shows as no longer
 * offered until the athlete picks another, rather than switching silently (ADR 0036).
 */
const coachModelSchema = z.string().min(1).catch(DEFAULT_COACH_MODEL);

export const coachModelsSchema = z.object({
  chat: coachModelSchema.default(DEFAULT_COACH_MODEL),
  plan: coachModelSchema.default(DEFAULT_COACH_MODEL),
});

export type CoachModels = z.infer<typeof coachModelsSchema>;

export const DEFAULT_COACH_MODELS: CoachModels = {
  chat: DEFAULT_COACH_MODEL,
  plan: DEFAULT_COACH_MODEL,
};

export function isCoachModel(id: string): id is CoachModelId {
  return COACH_MODELS.some((model) => model.id === id);
}

/** A stored choice keeps its id, including models no longer listed. */
export function coachModelLabel(id: string) {
  if (id === "mock") return "Mock coach";
  return COACH_MODELS.find((model) => model.id === id)?.label ?? id;
}
