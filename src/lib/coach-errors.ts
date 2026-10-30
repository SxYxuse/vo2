import { ByokMissingError } from "@tanstack/ai/byok";

/** The reason a coach request failed, in the athlete's words, without switching model or key. */
export function coachErrorMessage(error: Error) {
  const text = error.message.toLowerCase();
  if (
    error instanceof ByokMissingError ||
    error.name === "ByokMissingError" ||
    text.includes("missing openrouter")
  ) {
    return "Add your OpenRouter key in Settings → Coach to use the coach.";
  }
  if (text.includes("402") || text.includes("insufficient credits")) {
    return "Your OpenRouter account is out of credit. Top it up on openrouter.ai, then try again.";
  }
  if (
    text.includes("401") ||
    text.includes("no auth credentials") ||
    text.includes("user not found")
  ) {
    return "OpenRouter rejected your key. Check it in Settings → Coach.";
  }
  if (text.includes("no endpoints found") || text.includes("is not a valid model")) {
    return "This model isn't available on OpenRouter right now. Pick another in Settings → Coach.";
  }
  return error.message;
}
