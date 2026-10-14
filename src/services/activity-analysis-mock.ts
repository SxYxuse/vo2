import {
  EventType,
  type AnyTextAdapter,
  type ModelMessage,
  type TextOptions,
} from "@tanstack/ai";

import { composeMockAnalysis } from "./activity-analysis.types.ts";
import type {
  ActivityOverview,
  CorrelationReport,
  EffortReport,
  ElevationSegmentsReport,
} from "./activity-analysis.types.ts";

const TOOL_ORDER = [
  "get_activity_overview",
  "detect_elevation_segments",
  "correlate_streams",
  "summarize_effort_phases",
] as const;

function hasToolResults(messages: ModelMessage[]) {
  return messages.some((message) => message.role === "tool");
}

function parseContent(content: ModelMessage["content"]) {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => {
              if (part && typeof part === "object" && "text" in part) return String(part.text);
              return JSON.stringify(part);
            })
            .join("")
        : JSON.stringify(content);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function namesByToolCallId(messages: ModelMessage[]) {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      const name = call.function?.name;
      if (call.id && name) names.set(call.id, name);
    }
  }
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectResults(messages: ModelMessage[]) {
  const byName: Record<string, unknown> = {};
  const names = namesByToolCallId(messages);
  const parsed: unknown[] = [];
  const toolMessages = messages.filter((message) => message.role === "tool");
  for (const [index, message] of toolMessages.entries()) {
    const value = parseContent(message.content);
    parsed.push(value);
    const name =
      message.name || names.get(message.toolCallId ?? "") || TOOL_ORDER[index];
    if (name) byName[name] = value;
  }
  const fromShape = {
    overview: parsed.find((value) => isRecord(value) && "hasStreams" in value),
    elevation: parsed.find((value) => isRecord(value) && "climbs" in value),
    correlations: parsed.find((value) => isRecord(value) && "pairs" in value),
    effort: parsed.find((value) => isRecord(value) && "gradeBuckets" in value),
  };
  return {
    overview: (byName.get_activity_overview ?? fromShape.overview) as ActivityOverview | undefined,
    elevation: (byName.detect_elevation_segments ?? fromShape.elevation) as
      | ElevationSegmentsReport
      | undefined,
    correlations: (byName.correlate_streams ?? fromShape.correlations) as CorrelationReport | undefined,
    effort: (byName.summarize_effort_phases ?? fromShape.effort) as EffortReport | undefined,
  };
}

function chunksOf(text: string, size = 90) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
}

export function mockActivityAnalysisText(): AnyTextAdapter {
  return {
    kind: "text",
    name: "mock",
    model: "mock-activity-analysis",
    async *chatStream(options: TextOptions) {
      const runId = options.runId ?? crypto.randomUUID();
      const threadId = options.threadId ?? crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const now = () => Date.now();
      yield {
        type: EventType.RUN_STARTED,
        runId,
        threadId,
        timestamp: now(),
      };

      if (!hasToolResults(options.messages as ModelMessage[])) {
        for (const [index, name] of TOOL_ORDER.entries()) {
          const toolCallId = `mock-${name}-${index}`;
          const args = "{}";
          yield {
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: name,
            toolName: name,
            parentMessageId: messageId,
            timestamp: now(),
            index,
          };
          yield {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: args,
            timestamp: now(),
          };
          yield {
            type: EventType.TOOL_CALL_END,
            toolCallId,
            toolCallName: name,
            toolName: name,
            input: {},
            timestamp: now(),
          };
        }
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          timestamp: now(),
          finishReason: "tool_calls",
        };
        return;
      }

      const text = composeMockAnalysis(collectResults(options.messages as ModelMessage[]));
      yield {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        timestamp: now(),
      };
      for (const delta of chunksOf(text)) {
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta,
          timestamp: now(),
        };
      }
      yield {
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        timestamp: now(),
      };
      yield {
        type: EventType.RUN_FINISHED,
        runId,
        threadId,
        timestamp: now(),
        finishReason: "stop",
      };
    },
    async structuredOutput() {
      throw new Error("Mock activity analysis does not support structured output.");
    },
  } as unknown as AnyTextAdapter;
}
