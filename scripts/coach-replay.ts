/*
 * Replays a recorded plan-writer request against a real model, on the developer's own key, and
 * checks the plan it writes with VO2's rules (checkPlan), retrying as production does. It is how a
 * prompt or rule change gets one real rewrite before it merges: the mock coach skips the prompt.
 *
 * Opt-in: it costs money and needs a key, so the gate and CI never run it.
 *
 *   OPENROUTER_API_KEY=… vp run coach:replay [--request <file>] [--model <id>] [--reasoning <level>]
 *   OPENAI_API_KEY=… vp run coach:replay --provider openai --model <id>
 *   vp run coach:replay --dry-run     writes the request it would send to
 *                                     .dev-seed/plan-writer-dry-run.json; needs no key
 *
 * The request is recorded by the dev server (`vp run dev:mock`, not start:mock) each time the mock
 * coach writes a plan: `vp run dev:seed --coach-plan`, or Write again on Plan, and it lands in
 * .dev-seed/plan-writer-request.json. It holds the mock athlete's training only, and .dev-seed is
 * gitignored: never commit a request recorded from a real athlete, or a key.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { ReasoningLevel } from "@tanstack/ai";
import { config } from "dotenv";

config({ path: [".env"], quiet: true });

const { values } = parseArgs({
  options: {
    request: { type: "string", default: ".dev-seed/plan-writer-request.json" },
    provider: { type: "string", default: "openrouter" },
    model: { type: "string" },
    reasoning: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const DRY_RUN_PATH = ".dev-seed/plan-writer-dry-run.json";

function fail(message: string): never {
  console.error(`coach:replay: ${message}`);
  process.exit(1);
}

const KEY_ENV = { openrouter: "OPENROUTER_API_KEY", openai: "OPENAI_API_KEY" } as const;
const provider = values.provider as keyof typeof KEY_ENV;
if (!(provider in KEY_ENV)) fail(`--provider is openrouter or openai, not ${values.provider}.`);
const key = process.env[KEY_ENV[provider]]?.trim();
if (!key && !values["dry-run"]) {
  fail(
    `no key: set ${KEY_ENV[provider]} to your own ${provider} key for this run, or pass --dry-run to see the request without sending it.`,
  );
}

let recorded: { prompt: unknown; ctx: unknown; anchors: unknown };
try {
  recorded = JSON.parse(readFileSync(values.request, "utf8"));
} catch {
  fail(
    `no request at ${values.request}: start \`vp run dev:mock\` (not start:mock: only the dev server records), then \`vp run dev:seed --coach-plan\` records one there.`,
  );
}

// Imported once the arguments are checked: the writer reads the app's environment.
const [{ DEFAULT_COACH_MODEL, REASONING_LEVELS }, { textAdapter }, writer] = await Promise.all([
  import("../src/services/coach-models.ts"),
  import("../src/services/coach-model.server.ts"),
  import("../src/services/coach-plan-writer.server.ts"),
]);
type Recorded = Parameters<typeof writer.writeSessions>;
const prompt = recorded.prompt as Recorded[1];
const ctx = recorded.ctx as Recorded[2];
const anchors = recorded.anchors as Recorded[3];

const model = values.model ?? (provider === "openrouter" ? DEFAULT_COACH_MODEL.model : null);
if (!model) fail("--model names the OpenAI model to run.");
const reasoning = (values.reasoning ?? null) as ReasoningLevel | null;
if (reasoning != null && !REASONING_LEVELS.includes(reasoning)) {
  fail(`--reasoning is one of ${REASONING_LEVELS.join(", ")}.`);
}

if (values["dry-run"]) {
  // To a file: the app's logger prints to stdout as the writer loads, so stdout isn't clean JSON.
  const request = { provider, model, reasoning, ...writer.planRequest(prompt, ctx) };
  writeFileSync(DRY_RUN_PATH, JSON.stringify({ ...request, output: "writtenPlanSchema" }, null, 2));
  console.log(`coach:replay: the request it would send to ${model} is in ${DRY_RUN_PATH}.`);
  process.exit(0);
}

const started = Date.now();
const result = await writer.writeSessions(
  {
    kind: "live",
    provider,
    model,
    adapter: textAdapter({ provider, model, reasoning }, key!),
    reasoning: reasoning ?? undefined,
    key: key!,
  },
  prompt,
  ctx,
  anchors,
);
const seconds = Math.round((Date.now() - started) / 1000);
if (!result.ok) {
  console.error(`coach:replay: ${model} failed after ${seconds} s.\n${result.error}`);
  process.exit(1);
}
console.log(
  `coach:replay: ${model} wrote ${result.sessions.length} sessions in ${seconds} s, and they pass checkPlan.`,
);
for (const session of result.sessions) {
  console.log(`  ${session.weekStart}  ${writer.sessionLine(session)}  ${session.title}`);
}
