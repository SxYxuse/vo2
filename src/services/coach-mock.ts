import { EventType, type AnyTextAdapter, type ModelMessage, type TextOptions } from "@tanstack/ai";

import { metresText, type WrittenSession } from "./coach-plan.types.ts";

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

/** A session as get_coach_plan gives it: no week of its own, and no day (ADR 0048). */
type MockSession = Omit<WrittenSession, "weekStart"> & {
  id: string;
  status: "open" | "done";
  distanceKm: number;
  minutes: number;
};
type MockCoachPlan = {
  canChange: boolean;
  message?: string;
  weeks: { weekStart: string; sessions: MockSession[] }[];
};
type Asked = { weekStart: string | null; kind: "fewer" | "indoor" | "easier" | "away" };

/** Each kind of change, from the words of a week note or a chat message. */
function kindOf(text: string): Asked["kind"] | null {
  if (/can'?t (?:run|train)|only run (?:once|twice|\w+ times)/i.test(text)) return "fewer";
  if (/indoors|treadmill/i.test(text)) return "indoor";
  if (/too hard|take it easy|short on time/i.test(text)) return "easier";
  if (/travel|away for/i.test(text)) return "away";
  return null;
}

/**
 * What the athlete asked, for the phrasings the mock coach knows: a week note ("Note on my plan
 * for the week of 2026-06-15: …") or "I can only run twice this week" in the chat.
 */
function askedChange(text: string): Asked | null {
  const note = /Note on my plan for the week of (\d{4}-\d{2}-\d{2}): (.*)/s.exec(text);
  if (note) return { weekStart: note[1], kind: kindOf(note[2]) ?? "easier" };
  const kind = kindOf(text);
  return kind ? { weekStart: null, kind } : null;
}

function easierSession(weekStart: string, session: MockSession): WrittenSession {
  const base = { weekStart, sport: session.sport, kind: "easy" as const };
  const why = "Shorter and easy, so the week stays light.";
  if (session.sport === "ride") {
    const minutes = Math.max(30, Math.round(session.minutes / 10) * 5);
    const step = {
      part: "work" as const,
      distanceM: null,
      durationS: minutes * 60,
      pace: null,
      secPerKm: null,
      drill: null,
    };
    return {
      ...base,
      title: `${minutes} min endurance ride`,
      why,
      blocks: [{ repeat: 1, steps: [{ ...step, zone: "endurance", effort: null }] }],
    };
  }
  if (session.sport === "swim") {
    const metres = Math.max(1000, Math.round((session.distanceKm * 1000) / 200) * 100);
    return {
      ...base,
      title: `${metresText(metres)} endurance swim`,
      why,
      blocks: [
        {
          repeat: 1,
          steps: [
            {
              part: "work",
              distanceM: metres,
              durationS: null,
              pace: null,
              secPerKm: null,
              zone: "endurance",
              effort: null,
              drill: null,
            },
          ],
        },
      ],
    };
  }
  const km = Math.max(3, Math.round(session.distanceKm / 2));
  return {
    ...base,
    title: `${km} km easy`,
    why,
    blocks: [
      {
        repeat: 1,
        steps: [
          {
            part: "work",
            distanceM: km * 1000,
            durationS: null,
            pace: null,
            secPerKm: null,
            zone: null,
            effort: "easy",
            drill: null,
          },
        ],
      },
    ],
  };
}

/** The changes the mock coach tries, in order, until one passes VO2's rules. */
function candidateChanges(weekStart: string, open: MockSession[], kind: Asked["kind"]) {
  const written = ({
    id: _id,
    status: _s,
    distanceKm: _km,
    minutes: _minutes,
    ...session
  }: MockSession) => ({
    ...session,
    weekStart,
  });
  if (kind === "easier") {
    return [
      {
        summary: `An easier, shorter ${open[0].sport} this week.`,
        sessions: [{ id: open[0].id, session: easierSession(weekStart, open[0]) }],
      },
    ];
  }
  if (kind === "indoor") {
    const where = { ride: "trainer", run: "treadmill", swim: "pool" }[open[0].sport];
    const on = open[0].sport === "swim" ? "in the" : "on a";
    const indoor = { ...written(open[0]), title: `${open[0].title} (${where})` };
    return [
      {
        summary: `The same session, ${on} ${where}.`,
        sessions: [{ id: open[0].id, session: indoor }],
      },
    ];
  }
  // One session fewer: the long session stays, and of the others the shorter go first.
  const isLong = (session: MockSession) => (session.kind === "long" ? 1 : 0);
  return [...open]
    .sort((a, b) => isLong(a) - isLong(b) || a.minutes - b.minutes)
    .map((target) => ({
      summary: `${target.title} is dropped: a missed session is skipped, never made up.`,
      sessions: [{ id: target.id, session: null }],
    }));
}

/**
 * Away for a while: over the next three weeks, the shortest session of each week that isn't the
 * long one is dropped, and the first week's long session gets easier. A change over several
 * weeks, with drops and a replacement; then the drops alone if that breaks a rule.
 */
function awayChanges(weeks: MockCoachPlan["weeks"]) {
  const open = weeks
    .slice(0, 3)
    .map((week) => ({
      weekStart: week.weekStart,
      sessions: week.sessions.filter((item) => item.status === "open" && item.kind !== "race"),
    }))
    .filter((week) => week.sessions.length > 1);
  const drops = open.flatMap((week) => {
    const short = week.sessions
      .filter((item) => item.kind !== "long")
      .sort((a, b) => a.minutes - b.minutes)[0];
    return short ? [{ id: short.id, session: null }] : [];
  });
  const long = open[0]?.sessions.find((item) => item.kind === "long");
  const summary = "Lighter weeks while you're away: a short session goes each week.";
  return [
    ...(long
      ? [
          {
            summary: `${summary} Your first long run is easier too.`,
            sessions: [{ id: long.id, session: easierSession(open[0].weekStart, long) }, ...drops],
          },
        ]
      : []),
    { summary, sessions: drops },
  ].filter((change) => change.sessions.length);
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
  const week = asked.weekStart
    ? plan.weeks.find((item) => item.weekStart === asked.weekStart)
    : plan.weeks[0];
  const open = (week?.sessions ?? []).filter(
    (session) => session.status === "open" && session.kind !== "race",
  );
  if (!week || !open.length) {
    return {
      kind: "text",
      text: "There's no open session that week, so your plan needs no change.",
    };
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
  const candidates =
    asked.kind === "away"
      ? awayChanges(plan.weeks)
      : candidateChanges(week.weekStart, open, asked.kind);
  const next = candidates[proposals.length];
  if (!next) {
    return {
      kind: "text",
      text: `I couldn't find a change that keeps your plan's rules:\n\n${(last?.broken ?? []).map((item) => `- ${item}`).join("\n")}`,
    };
  }
  return { kind: "tools", calls: [{ name: "propose_plan_change", input: next }] };
}

// ----- Power files (ADR 0057) -----

type MockPowerFile = {
  id: string;
  title: string;
  pedaling: {
    overall: {
      rightPct: number | null;
      left: { pcoMm: number | null };
      right: { pcoMm: number | null };
    };
  };
};

/** The power file the athlete's last message links to, like [Morning Ride](/power/<id>). */
function linkedPowerFile(messages: ModelMessage[]) {
  const question = messages[lastUserIndex(messages)];
  const match = question ? /\]\(\/power\/([^)\s]+)\)/.exec(textOf(question.content)) : null;
  return match ? decodeURIComponent(match[1]) : null;
}

function signedMm(value: number | null) {
  if (value == null) return "no";
  return `${value > 0 ? "+" : ""}${value} mm`;
}

function powerFileText(file: MockPowerFile | undefined) {
  if (!file?.pedaling)
    return "I couldn't read that power file. Open it on the Power page and ask again.";
  const { rightPct, left, right } = file.pedaling.overall;
  const balance =
    rightPct == null
      ? "This file has no left/right balance: the power meter measures one side."
      : `Your legs split the work L ${Math.round(100 - rightPct)} / R ${Math.round(rightPct)}, ${Math.abs(rightPct - 50) <= 2 ? "well within the usual range" : "a little uneven"}.`;
  return [
    "This is the mock coach: no model key is set, so the answer is scripted.",
    "",
    `On [${file.title}](/power/${file.id}): ${balance} Your platform center offset is ${signedMm(left.pcoMm)} on the left and ${signedMm(right.pcoMm)} on the right.`,
    "",
    "- With your own key, the coach explains each number, whether it's normal for you, and what to change.",
  ].join("\n");
}

function powerFileStep(messages: ModelMessage[]): Step | null {
  const id = linkedPowerFile(messages);
  if (!id) return null;
  const results = resultsThisTurn(messages);
  if (!results.has("get_power_file")) {
    return { kind: "tools", calls: [{ name: "get_power_file", input: { powerFileId: id } }] };
  }
  return { kind: "text", text: powerFileText(results.get("get_power_file") as MockPowerFile) };
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

// ----- The stream (keep it shaped like the real provider's) -----
//
// The mock coach must keep streaming the way the real adapters do (TanStack AI's OpenRouter and
// OpenAI text adapters), event for event: chat bugs that only show live reproduce here, or nowhere
// before an athlete hits them. The scroll fix in coach-chat.tsx (the chat jumped back to an old
// question mid-reply) only reproduced once the mock streamed reasoning first and tool arguments in
// pieces, at a model's pace. So, like the real adapters:
// - nothing arrives before the first token's latency, and RUN_STARTED comes with the first chunk;
// - every step starts with reasoning, in token-sized deltas, and has no STEP_* events;
// - a step that calls tools streams each call's arguments in token-sized pieces, ends every call
//   only when the step finishes, and closes the reasoning after them;
// - a step that answers closes the reasoning when the first text arrives, and each text delta
//   carries the text so far.
// Check the adapter's processStreamChunks after a TanStack AI upgrade and follow what it does.
//
// Pacing is a fast model's: about 100 tokens a second for reasoning and text. Tool arguments
// come four tokens per tick, so a visual's HTML takes a second or two rather than six: the e2e
// suite asks the coach many times, and a turn stays about as long as before (about 4 s).

/** Before anything streams, as a provider takes to start answering. */
const FIRST_TOKEN_MS = 300;
const TICK_MS = 10;
/** About a token: real deltas are a few characters, not a sentence. */
const TOKEN_CHARS = 4;
const ARGS_TOKENS_PER_TICK = 4;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The text in token-sized deltas, pausing a tick after every `perTick` of them. */
async function* paced(text: string, perTick = 1) {
  const deltas = text.match(new RegExp(`[\\s\\S]{1,${TOKEN_CHARS}}`, "g")) ?? [];
  for (const [index, delta] of deltas.entries()) {
    if (index % perTick === 0) await pause(TICK_MS);
    yield delta;
  }
}

type Step =
  | { kind: "tools"; calls: { name: string; input: Record<string, unknown> }[] }
  | { kind: "text"; text: string };

function reasoningFor(step: Step) {
  if (step.kind === "text") return "I have what I need from the tools, so I can answer now.";
  const names = step.calls.map((call) => call.name).join(" and ");
  return `To answer, I need to look at the athlete's data first, so I'll call ${names}.`;
}

function nextStep(messages: ModelMessage[], tools: string[]): Step {
  if (tools.includes("propose_plan_change")) {
    const change = planChangeStep(messages);
    if (change) return change;
  }
  const powerFile = powerFileStep(messages);
  if (powerFile) return powerFile;
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
  const model = "mock-coach";
  return {
    kind: "text",
    name: "mock",
    model,
    async *chatStream(options: TextOptions) {
      const runId = options.runId ?? crypto.randomUUID();
      const threadId = options.threadId ?? crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const reasoningId = crypto.randomUUID();
      const at = () => ({ model, timestamp: Date.now() });
      const step = nextStep(
        options.messages as ModelMessage[],
        (options.tools ?? []).map((tool) => tool.name),
      );

      await pause(FIRST_TOKEN_MS);
      yield { type: EventType.RUN_STARTED, runId, threadId, ...at() };
      yield { type: EventType.REASONING_START, messageId: reasoningId, ...at() };
      yield {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningId,
        role: "reasoning",
        ...at(),
      };
      for await (const delta of paced(reasoningFor(step))) {
        yield { type: EventType.REASONING_MESSAGE_CONTENT, messageId: reasoningId, delta, ...at() };
      }
      const endReasoning = [
        { type: EventType.REASONING_MESSAGE_END, messageId: reasoningId, ...at() },
        { type: EventType.REASONING_END, messageId: reasoningId, ...at() },
      ];

      if (step.kind === "tools") {
        const calls = step.calls.map((call) => ({
          ...call,
          toolCallId: `mock-${call.name}-${crypto.randomUUID()}`,
          args: JSON.stringify(call.input),
        }));
        for (const [index, call] of calls.entries()) {
          yield {
            type: EventType.TOOL_CALL_START,
            toolCallId: call.toolCallId,
            toolCallName: call.name,
            parentMessageId: messageId,
            index,
            ...at(),
          };
          for await (const delta of paced(call.args, ARGS_TOKENS_PER_TICK)) {
            yield { type: EventType.TOOL_CALL_ARGS, toolCallId: call.toolCallId, delta, ...at() };
          }
        }
        for (const call of calls) {
          yield {
            type: EventType.TOOL_CALL_END,
            toolCallId: call.toolCallId,
            toolCallName: call.name,
            args: call.args,
            input: call.input,
            ...at(),
          };
        }
        yield* endReasoning;
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          finishReason: "tool_calls",
          ...at(),
        };
        return;
      }

      yield* endReasoning;
      yield { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant", ...at() };
      let content = "";
      for await (const delta of paced(step.text)) {
        content += delta;
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta, content, ...at() };
      }
      yield { type: EventType.TEXT_MESSAGE_END, messageId, ...at() };
      yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "stop", ...at() };
    },
    async structuredOutput() {
      throw new Error("The mock coach does not support structured output.");
    },
  } as unknown as AnyTextAdapter;
}
