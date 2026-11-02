import { EventType, type AnyTextAdapter, type ModelMessage, type TextOptions } from "@tanstack/ai";

import type { WrittenSession } from "./coach-plan.types.ts";

type MockActivity = { id: string; name: string; day: string; movingTimeS: number };

function textOf(content: ModelMessage["content"]) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join("");
}

function lastUserIndex(messages: ModelMessage[]) {
  let lastUser = messages.length - 1;
  while (lastUser >= 0 && messages[lastUser].role !== "user") lastUser -= 1;
  return lastUser;
}

/** Every tool result since the athlete's last message, oldest first. */
function resultListThisTurn(messages: ModelMessage[]) {
  const turn = messages.slice(lastUserIndex(messages) + 1);
  const names = new Map<string, string>();
  for (const message of turn) {
    for (const call of message.toolCalls ?? []) names.set(call.id, call.function.name);
  }
  const results: { name: string; value: unknown }[] = [];
  for (const message of turn) {
    if (message.role !== "tool") continue;
    const name = names.get(message.toolCallId ?? "");
    if (!name) continue;
    try {
      results.push({ name, value: JSON.parse(textOf(message.content)) });
    } catch {
      results.push({ name, value: textOf(message.content) });
    }
  }
  return results;
}

/** Tool results since the athlete's last message, by tool name (the latest of each). */
function resultsThisTurn(messages: ModelMessage[]) {
  return new Map(resultListThisTurn(messages).map(({ name, value }) => [name, value]));
}

// ----- Plan changes on the coach plan (ADR 0038) -----

type MockSession = WrittenSession & { distanceKm: number };
type MockCoachPlan = {
  canChange: boolean;
  message?: string;
  firstChangeableDay: string;
  availability: { days: string[] };
  weeks: { weekStart: string; sessions: MockSession[] }[];
};

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * What the athlete asked, for the phrasings the mock coach knows: a day note ("Note on my plan for
 * Thursday 2026-06-18: …") or "I can't run on Thursday" in the chat.
 */
function askedChange(text: string) {
  const note = /Note on my plan for \w+ (\d{4}-\d{2}-\d{2}): (.*)/s.exec(text);
  if (note) {
    const kind = /can't (?:train|run)/i.test(note[2])
      ? "cant"
      : /indoors/i.test(note[2])
        ? "indoor"
        : "easier";
    return { date: note[1], weekday: null, kind } as const;
  }
  const cant = /can'?t (?:run|train)(?: on)? (\w+day)/i.exec(text);
  const weekday = cant ? WEEKDAY_NAMES.indexOf(cant[1].toLowerCase()) : -1;
  if (weekday >= 0) return { date: null, weekday, kind: "cant" } as const;
  if (/too hard|take it easy/i.test(text)) return { date: null, weekday: null, kind: "easier" };
  return null;
}

function easierRun(session: MockSession): WrittenSession {
  const km = Math.max(3, Math.round(session.distanceKm / 2));
  return {
    date: session.date,
    kind: "easy",
    title: `${km} km easy`,
    why: "Shorter and easy, so the day stays light.",
    blocks: [
      {
        repeat: 1,
        steps: [
          { part: "work", distanceM: km * 1000, durationS: null, pace: null, effort: "easy" },
        ],
      },
    ],
  };
}

/** The changes the mock coach tries, in order, until one passes VO2's rules. */
function candidateChanges(plan: MockCoachPlan, target: MockSession, kind: string) {
  const { date: _date, distanceKm: _km, ...written } = target;
  const day = weekdayOf(target.date);
  if (kind === "easier") {
    return [
      {
        summary: "An easier, shorter run that day.",
        days: [{ date: target.date, session: easierRun(target) }],
      },
    ];
  }
  if (kind === "indoor") {
    const indoor = { ...written, date: target.date, title: `${target.title} (treadmill)` };
    return [
      { summary: "The same run, on a treadmill.", days: [{ date: target.date, session: indoor }] },
    ];
  }
  const week = plan.weeks.find((item) => item.sessions.includes(target))!;
  const open = plan.availability.days.map((text) => WEEKDAY_NAMES.indexOf(text.toLowerCase()));
  const moves = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.parse(`${week.weekStart}T12:00:00Z`) + index * 86_400_000);
    return date.toISOString().slice(0, 10);
  })
    .filter(
      (date) =>
        date >= plan.firstChangeableDay &&
        date !== target.date &&
        open.includes(weekdayOf(date)) &&
        !week.sessions.some((session) => session.date === date),
    )
    .map((date) => ({
      summary: `${target.title} moves from ${WEEKDAY_NAMES[day]} to ${WEEKDAY_NAMES[weekdayOf(date)]}.`,
      days: [
        { date: target.date, session: null },
        { date, session: { ...written, date } },
      ],
    }));
  return [
    ...moves,
    {
      summary: `${target.title} is dropped: a missed run is skipped, never made up.`,
      days: [{ date: target.date, session: null }],
    },
  ];
}

function appliedText(result: unknown) {
  const applied = result as { applied?: boolean; reason?: string } | undefined;
  if (applied?.applied === true) return "Done: the change is in your plan.";
  if (applied?.reason) return applied.reason;
  return "No problem: your plan stays as it was.";
}

/** The mock coach's plan change: read the plan, propose until a change passes, then offer it. */
function planChangeStep(messages: ModelMessage[]): Step | null {
  const asked = askedChange(textOf(messages[lastUserIndex(messages)]?.content ?? ""));
  if (!asked) return null;
  const results = resultListThisTurn(messages);
  const plan = results.find((result) => result.name === "get_coach_plan")?.value as
    | MockCoachPlan
    | undefined;
  if (!plan) return { kind: "tools", calls: [{ name: "get_coach_plan", input: {} }] };
  if (!plan.canChange) return { kind: "text", text: plan.message ?? "The plan can't change now." };
  const applied = results.find((result) => result.name === "apply_plan_change");
  if (applied) return { kind: "text", text: appliedText(applied.value) };
  const ahead = plan.weeks
    .flatMap((week) => week.sessions)
    .filter((session) => session.date >= plan.firstChangeableDay && session.kind !== "race");
  const target =
    asked.date != null
      ? ahead.find((session) => session.date === asked.date)
      : asked.weekday != null
        ? ahead.find((session) => weekdayOf(session.date) === asked.weekday)
        : ahead[0];
  if (!target) {
    return { kind: "text", text: "There's no run planned then, so your plan needs no change." };
  }
  const proposals = results.filter((result) => result.name === "propose_plan_change");
  const last = proposals.at(-1)?.value as
    | { ok?: boolean; proposalId?: string; broken?: string[] }
    | undefined;
  if (last?.ok && last.proposalId) {
    return {
      kind: "tools",
      calls: [{ name: "apply_plan_change", input: { proposalId: last.proposalId } }],
    };
  }
  const candidates = candidateChanges(plan, target, asked.kind);
  const next = candidates[proposals.length];
  if (!next) {
    return {
      kind: "text",
      text: `I couldn't find a change that keeps your plan's rules:\n\n${(last?.broken ?? []).map((item) => `- ${item}`).join("\n")}`,
    };
  }
  return { kind: "tools", calls: [{ name: "propose_plan_change", input: next }] };
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

// Paced like a real model, so the chat's scrolling and loading states show as they would live.
const TOOL_PAUSE_MS = 600;
const TEXT_PAUSE_MS = 40;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Step =
  | { kind: "tools"; calls: { name: string; input: Record<string, unknown> }[] }
  | { kind: "text"; text: string };

function nextStep(messages: ModelMessage[], tools: string[]): Step {
  if (tools.includes("propose_plan_change")) {
    const change = planChangeStep(messages);
    if (change) return change;
  }
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

      // Like a reasoning model, think a little before each step.
      const reasoningId = crypto.randomUUID();
      const stepId = crypto.randomUUID();
      yield { type: EventType.REASONING_START, messageId: reasoningId, timestamp };
      yield {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningId,
        role: "reasoning",
        timestamp,
      };
      yield {
        type: EventType.STEP_STARTED,
        stepName: stepId,
        stepId,
        stepType: "thinking",
        timestamp,
      };
      for (const delta of ["Looking at ", "what the athlete ", "asked."]) {
        await pause(TEXT_PAUSE_MS);
        yield {
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId: reasoningId,
          delta,
          timestamp,
        };
      }
      yield { type: EventType.REASONING_MESSAGE_END, messageId: reasoningId, timestamp };
      yield { type: EventType.REASONING_END, messageId: reasoningId, timestamp };
      yield { type: EventType.STEP_FINISHED, stepName: stepId, stepId, timestamp };

      const step = nextStep(
        options.messages as ModelMessage[],
        (options.tools ?? []).map((tool) => tool.name),
      );
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
          // Arguments stream in pieces, so a visual's HTML arrives over a few seconds.
          for (const delta of JSON.stringify(call.input).match(/[\s\S]{1,200}/g) ?? []) {
            await pause(TEXT_PAUSE_MS);
            yield { type: EventType.TOOL_CALL_ARGS, toolCallId, delta, timestamp };
          }
          await pause(TOOL_PAUSE_MS);
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
      for (const delta of step.text.match(/[\s\S]{1,12}/g) ?? []) {
        await pause(TEXT_PAUSE_MS);
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
