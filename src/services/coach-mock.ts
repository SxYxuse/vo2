import { EventType, type AnyTextAdapter, type ModelMessage, type TextOptions } from "@tanstack/ai";

type MockActivity = { id: string; name: string; day: string; movingTimeS: number };

function textOf(content: ModelMessage["content"]) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join("");
}

/** Tool results since the athlete's last message, by tool name. */
function resultsThisTurn(messages: ModelMessage[]) {
  let lastUser = messages.length - 1;
  while (lastUser >= 0 && messages[lastUser].role !== "user") lastUser -= 1;
  const turn = messages.slice(lastUser + 1);
  const names = new Map<string, string>();
  for (const message of turn) {
    for (const call of message.toolCalls ?? []) names.set(call.id, call.function.name);
  }
  const results = new Map<string, unknown>();
  for (const message of turn) {
    if (message.role !== "tool") continue;
    const name = names.get(message.toolCallId ?? "");
    if (!name) continue;
    try {
      results.set(name, JSON.parse(textOf(message.content)));
    } catch {
      results.set(name, textOf(message.content));
    }
  }
  return results;
}

function recentActivities(results: Map<string, unknown>): MockActivity[] {
  const found = results.get("find_activities") as { activities?: MockActivity[] } | undefined;
  return (found?.activities ?? []).slice(0, 7).reverse();
}

function visualHtml(activities: MockActivity[]) {
  const max = Math.max(1, ...activities.map((activity) => activity.movingTimeS));
  const width = 100 / Math.max(1, activities.length);
  const bars = activities
    .map((activity, index) => {
      const height = Math.round((activity.movingTimeS / max) * 140);
      const x = index * width + width * 0.15;
      return `<rect x="${x}%" y="${160 - height}" width="${width * 0.7}%" height="${height}" rx="3" fill="var(--chart-2)"><title>${activity.name}: ${Math.round(activity.movingTimeS / 60)} min</title></rect><text x="${x + width * 0.35}%" y="178" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">${activity.day.slice(5)}</text>`;
    })
    .join("");
  return `<!doctype html><html><body><svg width="100%" height="184" role="img" aria-label="Moving time of recent activities"><line x1="0" x2="100%" y1="160" y2="160" stroke="var(--border)"/>${bars}</svg></body></html>`;
}

function finalText(activities: MockActivity[]) {
  const latest = activities.at(-1);
  if (!latest) {
    return "There are no activities in your local copy yet. Run **Sync from Strava** and ask me again.";
  }
  return [
    "This is the mock coach: no model key is set, so the answer is scripted.",
    "",
    `Your latest activity is [${latest.name}](/activities/${latest.id}) on ${latest.day}, ${Math.round(latest.movingTimeS / 60)} minutes on the move. The chart shows moving time for your last ${activities.length} activities.`,
    "",
    "- Ask about splits, heart rate, or form to see more tools run.",
    "- Type **@** to point me at a specific activity.",
  ].join("\n");
}

type Step =
  | { kind: "tools"; calls: { name: string; input: Record<string, unknown> }[] }
  | { kind: "text"; text: string };

function nextStep(messages: ModelMessage[]): Step {
  const results = resultsThisTurn(messages);
  if (!results.has("find_activities")) {
    return {
      kind: "tools",
      calls: [
        { name: "find_activities", input: { limit: 7 } },
        { name: "get_fitness", input: {} },
      ],
    };
  }
  const activities = recentActivities(results);
  if (activities.length && !results.has("show_visual")) {
    return {
      kind: "tools",
      calls: [
        {
          name: "show_visual",
          input: { title: "Recent moving time", html: visualHtml(activities) },
        },
      ],
    };
  }
  return { kind: "text", text: finalText(activities) };
}

/** A scripted coach for running without a model key: two tools, a visual, then markdown. */
export function mockCoachText(): AnyTextAdapter {
  return {
    kind: "text",
    name: "mock",
    model: "mock-coach",
    async *chatStream(options: TextOptions) {
      const runId = options.runId ?? crypto.randomUUID();
      const threadId = options.threadId ?? crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const timestamp = Date.now();
      yield { type: EventType.RUN_STARTED, runId, threadId, timestamp };

      const step = nextStep(options.messages as ModelMessage[]);
      if (step.kind === "tools") {
        for (const [index, call] of step.calls.entries()) {
          const toolCallId = `mock-${call.name}-${crypto.randomUUID()}`;
          const base = { toolCallId, toolCallName: call.name, toolName: call.name, timestamp };
          yield {
            type: EventType.TOOL_CALL_START,
            ...base,
            parentMessageId: messageId,
            index,
          };
          yield {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: JSON.stringify(call.input),
            timestamp,
          };
          yield { type: EventType.TOOL_CALL_END, ...base, input: call.input };
        }
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          timestamp,
          finishReason: "tool_calls",
        };
        return;
      }

      yield { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant", timestamp };
      for (const delta of step.text.match(/[\s\S]{1,40}/g) ?? []) {
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta, timestamp };
      }
      yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp };
      yield { type: EventType.RUN_FINISHED, runId, threadId, timestamp, finishReason: "stop" };
    },
    async structuredOutput() {
      throw new Error("The mock coach does not support structured output.");
    },
  } as unknown as AnyTextAdapter;
}
