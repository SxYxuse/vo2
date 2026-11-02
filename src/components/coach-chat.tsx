"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import type { ConnectionAdapter, UIMessage } from "@tanstack/ai-react";
import {
  ActivityIcon,
  CalendarSearchIcon,
  ChartLineIcon,
  FlagIcon,
  GaugeIcon,
  HeartPulseIcon,
  ListChecksIcon,
  ListOrderedIcon,
  MountainIcon,
  RefreshCwIcon,
  RulerIcon,
  SparklesIcon,
  SquarePenIcon,
  TargetIcon,
  TrendingUpIcon,
  TrophyIcon,
  WavesIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";

import { CoachChatList } from "@/components/coach-chat-list.tsx";
import { CoachComposer, type MentionableActivity } from "@/components/coach-composer.tsx";
import { CoachMarkdown, type ActivityLookup } from "@/components/coach-markdown.tsx";
import { CoachVisual } from "@/components/coach-visual.tsx";
import {
  PlanChangeCard,
  PlanChangeProvider,
  usePlanChanges,
} from "@/components/coach-plan-change.tsx";
import { CoachKeyPrompt, useCoachAvailable } from "@/components/coach-key.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { applyPlanChangeDef } from "@/services/coach-tools.ts";
import { coachChatQueryKey, coachChatsQueryOptions, homeQueryOptions } from "@/lib/queries.ts";
import { isSportTypeShown, sportTypeColor } from "@/services/athlete-settings.types.ts";
import { coachErrorMessage } from "@/lib/coach-errors.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

const STARTERS = [
  "How did my last run go?",
  "Am I fresh enough for a hard session tomorrow?",
  "What are my best 5 km times this year?",
];

/** Offered when the athlete came from "Ask the coach to change my plan". */
const PLAN_STARTERS = [
  "I can't run on Thursday this week",
  "This week feels too hard",
  "Can I swap my long run to Saturday?",
];

const TOOL_STEPS: Record<string, { running: string; done: string; icon: LucideIcon }> = {
  find_activities: {
    running: "Finding activities",
    done: "Found activities",
    icon: CalendarSearchIcon,
  },
  get_activity: { running: "Reading the activity", done: "Read the activity", icon: ActivityIcon },
  measure_activity: {
    running: "Measuring the activity",
    done: "Measured the activity",
    icon: RulerIcon,
  },
  get_activity_streams: { running: "Reading streams", done: "Read streams", icon: WavesIcon },
  find_climbs: { running: "Finding climbs", done: "Found climbs", icon: MountainIcon },
  correlate_streams: {
    running: "Correlating heart rate, speed, and terrain",
    done: "Correlated heart rate, speed, and terrain",
    icon: HeartPulseIcon,
  },
  summarize_effort_phases: {
    running: "Splitting effort by grade",
    done: "Split effort by grade",
    icon: GaugeIcon,
  },
  get_fitness: {
    running: "Reading fitness and form",
    done: "Read fitness and form",
    icon: TrendingUpIcon,
  },
  get_personal_bests: {
    running: "Reading personal bests",
    done: "Read personal bests",
    icon: TrophyIcon,
  },
  get_week_plan: {
    running: "Reading this week's plan",
    done: "Read this week's plan",
    icon: TargetIcon,
  },
  get_season: { running: "Reading the season", done: "Read the season", icon: FlagIcon },
  get_athlete_profile: {
    running: "Reading zones and anchors",
    done: "Read zones and anchors",
    icon: ListOrderedIcon,
  },
  show_visual: { running: "Drawing a visual", done: "Drew a visual", icon: ChartLineIcon },
  get_coach_plan: {
    running: "Reading your coach plan",
    done: "Read your coach plan",
    icon: TargetIcon,
  },
  propose_plan_change: {
    running: "Checking a change against your plan's rules",
    done: "Checked a change against your plan's rules",
    icon: ListChecksIcon,
  },
};

type Part = UIMessage["parts"][number];
type ToolCall = Extract<Part, { type: "tool-call" }>;
type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tools"; calls: ToolCall[] }
  | { kind: "visual"; call: ToolCall }
  | { kind: "change"; call: ToolCall };

/** Text, thinking, visuals, and runs of tool calls, in the order the coach produced them. */
function blocksOf(parts: readonly Part[]): Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    const last = blocks.at(-1);
    if (part.type === "text" && part.content.trim()) {
      if (last?.kind === "text") last.text += part.content;
      else blocks.push({ kind: "text", text: part.content });
    } else if (part.type === "thinking" && part.content.trim()) {
      blocks.push({ kind: "thinking", text: part.content });
    } else if (part.type === "tool-call" && part.name === "show_visual") {
      blocks.push({ kind: "visual", call: part });
    } else if (part.type === "tool-call" && part.name === "apply_plan_change") {
      blocks.push({ kind: "change", call: part });
    } else if (part.type === "tool-call") {
      if (last?.kind === "tools") last.calls.push(part);
      else blocks.push({ kind: "tools", calls: [part] });
    }
  }
  return blocks;
}

function failedCalls(parts: readonly Part[]) {
  return new Set(
    parts.flatMap((part) =>
      part.type === "tool-result" && part.state === "error" ? [part.toolCallId] : [],
    ),
  );
}

function ToolTrace({
  calls,
  failed,
  live,
}: {
  calls: ToolCall[];
  failed: Set<string>;
  live: boolean;
}) {
  // A stopped or failed run leaves calls without output; only the reply streaming now runs.
  const finished = (call: ToolCall) =>
    !live || call.state === "complete" || call.output !== undefined;
  const running = !calls.every(finished);
  // Open while the coach works, folded once it's done, unless the athlete toggled it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  return (
    <Trace aria-live="polite">
      <TraceCollapsible open={toggled ?? running} onOpenChange={setToggled}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon>
              <SparklesIcon />
            </TraceIcon>
            <TraceTitle>{running ? "Looking at your data" : "Looked at your data"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {calls.map((call) => {
              const step = TOOL_STEPS[call.name] ?? {
                running: call.name,
                done: call.name,
                icon: SparklesIcon,
              };
              const done = finished(call);
              const error = failed.has(call.id);
              return (
                <TraceLine key={call.id} status={error ? "error" : done ? undefined : "running"}>
                  <TraceIcon>
                    <step.icon />
                  </TraceIcon>
                  <TraceTitle>{done ? step.done : step.running}</TraceTitle>
                </TraceLine>
              );
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function ThinkingTrace({ text }: { text: string }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>Thought it through</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <p className="text-muted-foreground text-xs/relaxed whitespace-pre-wrap">{text}</p>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function VisualBlock({ call, live }: { call: ToolCall; live: boolean }) {
  const input = call.input as { title?: unknown; html?: unknown } | undefined;
  const ready =
    call.state !== "awaiting-input" &&
    call.state !== "input-streaming" &&
    typeof input?.html === "string";
  if (!ready) {
    return (
      <Trace>
        <TraceLine status={live ? "running" : "error"}>
          <TraceIcon>
            <ChartLineIcon />
          </TraceIcon>
          <TraceTitle>{live ? "Drawing a visual" : "Visual not finished"}</TraceTitle>
        </TraceLine>
      </Trace>
    );
  }
  return (
    <CoachVisual
      title={typeof input.title === "string" ? input.title : "Visual"}
      html={input.html as string}
    />
  );
}

export function CoachMessage({
  message,
  lookup,
  live,
}: {
  message: UIMessage;
  lookup: ActivityLookup;
  live: boolean;
}) {
  if (message.role === "user") {
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.content] : []))
      .join("\n");
    return (
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent>
              <CoachMarkdown markdown={text} lookup={lookup} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  const failed = failedCalls(message.parts);
  return (
    <Message>
      <MessageContent className="gap-3">
        {blocksOf(message.parts).map((block, index) => (
          <Fragment key={index}>
            {block.kind === "text" ? <CoachMarkdown markdown={block.text} lookup={lookup} /> : null}
            {block.kind === "thinking" ? <ThinkingTrace text={block.text} /> : null}
            {block.kind === "tools" ? (
              <ToolTrace calls={block.calls} failed={failed} live={live} />
            ) : null}
            {block.kind === "visual" ? <VisualBlock call={block.call} live={live} /> : null}
            {block.kind === "change" ? <PlanChangeCard call={block.call} /> : null}
          </Fragment>
        ))}
      </MessageContent>
    </Message>
  );
}

function useMentionableActivities() {
  const { data } = useQuery(homeQueryOptions);
  return useMemo(() => {
    const sportTypes = data?.settings.sportTypes ?? {};
    const all = (data?.activities ?? []).map((activity) => ({
      id: activity.id,
      name: activity.title,
      sportType: activity.sportType,
      start: activity.start,
      color: sportTypeColor(sportTypes, activity.sportType),
    }));
    const byId = new Map(all.map((activity) => [activity.id, activity]));
    // Only what the athlete sees elsewhere can be picked; the coach still reads everything.
    const shown = all
      .filter((activity) => isSportTypeShown(sportTypes, activity.sportType))
      .sort((a, b) => b.start.localeCompare(a.start));
    return { shown, byId };
  }, [data]);
}

/**
 * Loads the chat from the server (TanStack AI hydration). Offline, it shows the copy saved the
 * last time this chat was open, so the installed app still reads it with no signal (ADR 0031).
 */
function coachConnection(queryClient: QueryClient): ConnectionAdapter {
  const server = fetchServerSentEvents("/api/coach");
  return {
    ...server,
    async hydrate(threadId, options) {
      try {
        return await server.hydrate!(threadId, options);
      } catch (error) {
        const saved = queryClient.getQueryData<UIMessage[]>(coachChatQueryKey(threadId));
        if (!saved) throw error;
        return { messages: saved, activeRun: null, interrupts: null };
      }
    },
  };
}

/**
 * One coach chat. The server keeps it, so the athlete can reopen it later from Chats on any
 * device; the one open last also reads offline.
 */
export function CoachChat({
  threadId,
  initialActivityId,
  onInitialActivitySent,
  planChange = false,
}: {
  threadId: string;
  initialActivityId?: string;
  onInitialActivitySent: () => void;
  /** Opened from "Ask the coach to change my plan": offer plan changes to start with. */
  planChange?: boolean;
}) {
  const online = useOnline();
  const { shown, byId } = useMentionableActivities();
  const coach = useCoachAvailable();
  const queryClient = useQueryClient();
  const [connection] = useState(() => coachConnection(queryClient));
  const {
    messages,
    sendMessage,
    isLoading,
    error,
    stop,
    reload,
    isHydrating,
    interrupts,
    resuming,
  } = useChat({
    connection,
    threadId,
    // Server-authoritative: the transcript is loaded from and saved on the server.
    persistence: true,
    // A new chat appears in Chats, and an older one moves to the top.
    onFinish: () =>
      void queryClient.invalidateQueries({ queryKey: coachChatsQueryOptions.queryKey }),
    forwardedProps: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    // The approval the coach asks for on a plan change binds to this definition.
    tools: [applyPlanChangeDef],
  });

  const lookup = useCallback<ActivityLookup>((id) => byId.get(id), [byId]);
  const initialMentions = useMemo<MentionableActivity[]>(() => {
    const activity = initialActivityId ? byId.get(initialActivityId) : undefined;
    return activity ? [activity] : [];
  }, [byId, initialActivityId]);

  // Keep only the chat open now for offline reading, so the saved copy stays small.
  useEffect(() => {
    if (isLoading || isHydrating || !messages.length) return;
    queryClient.removeQueries({
      queryKey: ["coach-chat"],
      predicate: (query) => query.queryKey[1] !== threadId,
    });
    queryClient.setQueryData(coachChatQueryKey(threadId), messages);
  }, [isHydrating, isLoading, messages, queryClient, threadId]);

  const lastQuestionId = messages.filter((message) => message.role === "user").at(-1)?.id;

  const send = (message: string) => {
    void sendMessage(message);
    if (initialActivityId) onInitialActivitySent();
  };
  const empty = !messages.length && !isHydrating;
  // The chat stays readable without a key; only asking needs one (ADR 0036).
  const { needsKey } = coach;
  const canAsk = online && !needsKey;
  const planChanges = usePlanChanges(messages, interrupts, canAsk && !isLoading && !resuming);
  // A run paused on the athlete's Apply or Decline takes no new message until it's answered,
  // even when the paused run was restored hours later.
  const awaitingAnswer = interrupts.length > 0;
  const canSend = canAsk && !awaitingAnswer;
  const starters = planChange ? PLAN_STARTERS : STARTERS;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <SparklesIcon aria-hidden className="size-5" />
          Coach
        </h1>
        <div className="flex items-center gap-2">
          <CoachChatList currentId={threadId} />
          {messages.length ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/coach" search={{}} />}
            >
              <SquarePenIcon />
              New chat
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {empty && error ? (
          // Loading the chat failed: offline and never opened here, or the server didn't answer.
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WifiOffIcon />
              </EmptyMedia>
              <EmptyTitle>This chat didn't load</EmptyTitle>
              <EmptyDescription>
                {online ? coachErrorMessage(error) : "It opens once you're back online."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : empty && needsKey ? (
          <CoachKeyPrompt>
            The coach answers on your own OpenRouter key. Add it once to ask about your training.
          </CoachKeyPrompt>
        ) : empty ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>Ask the coach</EmptyTitle>
              <EmptyDescription>
                Ask about any activity, your form, or your plan. Type @ to point at an activity.
              </EmptyDescription>
            </EmptyHeader>
            {/* A starter would send without the activity "Ask about this activity" brought in. */}
            {initialMentions.length ? null : (
              <EmptyContent className="flex-col">
                {starters.map((starter) => (
                  <Button
                    key={starter}
                    variant="outline"
                    className="h-auto min-h-11 w-full justify-start py-2 text-left whitespace-normal sm:min-h-8"
                    disabled={!canSend}
                    onClick={() => send(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <PlanChangeProvider value={planChanges}>
            <MessageScrollerProvider>
              <MessageScroller className="flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto w-full max-w-3xl pb-4">
                    {messages.map((message, index) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        // Only the latest question anchors: the scroller snaps to any anchor it
                        // hasn't scrolled to itself, so older ones pulled the view back up mid-reply.
                        scrollAnchor={message.id === lastQuestionId}
                        // Skipped offscreen rendering would size visuals at 0 and make the list
                        // jump as estimated heights turn real while scrolling back.
                        className="[content-visibility:visible]"
                      >
                        <CoachMessage
                          message={message}
                          lookup={lookup}
                          live={isLoading && index === messages.length - 1}
                        />
                      </MessageScrollerItem>
                    ))}
                    {error && !isLoading ? (
                      <MessageScrollerItem>
                        <Alert variant="destructive">
                          <AlertTitle>The coach could not answer</AlertTitle>
                          <AlertDescription>{coachErrorMessage(error)}</AlertDescription>
                          <AlertAction>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canSend}
                              onClick={() => void reload()}
                            >
                              <RefreshCwIcon />
                              Retry
                            </Button>
                          </AlertAction>
                        </Alert>
                      </MessageScrollerItem>
                    ) : null}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </PlanChangeProvider>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl shrink-0">
        <CoachComposer
          // The activities may still be loading on first paint; start again once it's known.
          key={`${initialActivityId}-${initialMentions.length}`}
          activities={shown}
          initialMentions={initialMentions}
          disabled={!canSend}
          placeholder={
            awaitingAnswer
              ? "Apply or decline the change above, then ask the coach again."
              : !online
                ? "You're offline. You can read this chat; the coach answers once you're back online."
                : needsKey
                  ? "Add your OpenRouter key in Settings → Coach to ask the coach."
                  : planChange
                    ? "Tell the coach what changed… (away, ill, too hard, swap days)"
                    : "Ask the coach… (@ to mention an activity)"
          }
          busy={isLoading}
          onSend={send}
          onStop={stop}
        />
      </div>
    </div>
  );
}
