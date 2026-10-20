import { EventType, type ModelMessage, type StreamChunk } from "@tanstack/ai";

export const MIN_SAVED_CHARS = 24;

const ANALYZE_PROMPT =
  "Analyze this activity. Call every stream tool you need. Correlate heart rate with elevation and grade, detect when the athlete is gaining elevation, and explain effort on climbs versus the flat.";

// The server owns the conversation: request bodies never reach the paid model,
// so a client can only choose which of its own activities to analyze.
export function analysisMessages(): ModelMessage[] {
  return [{ role: "user", content: ANALYZE_PROMPT }];
}

function textDelta(chunk: StreamChunk) {
  if (chunk.type !== EventType.TEXT_MESSAGE_CONTENT) return "";
  if (!("delta" in chunk) || typeof chunk.delta !== "string") return "";
  return chunk.delta;
}

// Each tool round ends with its own RUN_FINISHED marked "tool_calls", either at
// the top level or in metadata.tanstack (the same check the chat client makes).
function isFinalRunFinished(chunk: StreamChunk) {
  if (chunk.type !== EventType.RUN_FINISHED) return false;
  const extra = chunk as {
    finishReason?: unknown;
    metadata?: { tanstack?: { finishReason?: unknown } };
  };
  const finishReason = extra.finishReason ?? extra.metadata?.tanstack?.finishReason;
  return finishReason !== "tool_calls";
}

/**
 * Saves the streamed analysis exactly once. A completed run saves before the
 * final RUN_FINISHED is forwarded, because the client refetches the saved
 * analysis as soon as it sees that event. A stopped or failed run saves what
 * was written so far.
 */
export async function* persistAnalysisOnce(
  stream: AsyncIterable<StreamChunk>,
  save: (body: string) => Promise<unknown>,
) {
  let body = "";
  let saved = false;
  const saveOnce = async () => {
    if (saved || body.trim().length < MIN_SAVED_CHARS) return;
    saved = true;
    await save(body);
  };
  try {
    for await (const chunk of stream) {
      body += textDelta(chunk);
      if (isFinalRunFinished(chunk)) await saveOnce();
      yield chunk;
    }
  } finally {
    await saveOnce();
  }
}
