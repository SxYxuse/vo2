import { EventType, type StreamChunk } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";

import { analysisMessages, persistAnalysisOnce } from "./activity-analysis-run.ts";

const NOTE = "Steady climb, heart rate drifted on the second half.";

function text(delta: string) {
  return { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta } as StreamChunk;
}

function runFinished(finishReason?: string, inMetadata = false) {
  const base = { type: EventType.RUN_FINISHED, threadId: "t", runId: "r" };
  if (!finishReason) return base as StreamChunk;
  return (
    inMetadata ? { ...base, metadata: { tanstack: { finishReason } } } : { ...base, finishReason }
  ) as StreamChunk;
}

async function* chunks(list: StreamChunk[], failAfter?: number) {
  for (const [index, chunk] of list.entries()) {
    if (index === failAfter) throw new Error("stream failed");
    yield chunk;
  }
}

async function drain(stream: AsyncIterable<StreamChunk>, onChunk?: (chunk: StreamChunk) => void) {
  for await (const chunk of stream) onChunk?.(chunk);
}

describe("analysisMessages", () => {
  test("is a single fixed user prompt", () => {
    const messages = analysisMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });
});

describe("persistAnalysisOnce", () => {
  test("saves once, after tool rounds, before the final RUN_FINISHED reaches the client", async () => {
    const events: string[] = [];
    const save = async (body: string) => {
      events.push(`save:${body}`);
    };
    await drain(
      persistAnalysisOnce(
        chunks([
          runFinished("tool_calls"),
          runFinished("tool_calls", true),
          text(NOTE.slice(0, 10)),
          { type: EventType.TEXT_MESSAGE_END, messageId: "m" } as StreamChunk,
          text(NOTE.slice(10)),
          runFinished("stop"),
        ]),
        save,
      ),
      (chunk) => {
        if (chunk.type === EventType.RUN_FINISHED) events.push("finished");
      },
    );
    expect(events).toEqual(["finished", "finished", `save:${NOTE}`, "finished"]);
  });

  test("saves the partial note when the stream fails", async () => {
    const saved: string[] = [];
    await expect(
      drain(
        persistAnalysisOnce(chunks([text(NOTE), runFinished("stop")], 1), async (body) => {
          saved.push(body);
        }),
      ),
    ).rejects.toThrow("stream failed");
    expect(saved).toEqual([NOTE]);
  });

  test("saves the partial note when the client stops reading", async () => {
    const saved: string[] = [];
    for await (const chunk of persistAnalysisOnce(
      chunks([text(NOTE), text(" more"), runFinished("stop")]),
      async (body) => {
        saved.push(body);
      },
    )) {
      if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) break;
    }
    expect(saved).toEqual([NOTE]);
  });

  test("skips notes too short to keep", async () => {
    const saved: string[] = [];
    await drain(
      persistAnalysisOnce(chunks([text("ok"), runFinished()]), async (body) => {
        saved.push(body);
      }),
    );
    expect(saved).toEqual([]);
  });
});
