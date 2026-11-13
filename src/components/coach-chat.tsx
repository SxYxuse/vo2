"use client";

import { PageHeader } from "@/components/page-header.tsx";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import type { ConnectionAdapter, UIMessage } from "@tanstack/ai-react";
import {
  ActivityIcon,
  BatteryMediumIcon,
  BookOpenIcon,
  CalendarMinusIcon,
  CalendarSearchIcon,
  CheckIcon,
  ChartLineIcon,
  CopyIcon,
  FlagIcon,
  GaugeIcon,
  HeartPulseIcon,
  ListChecksIcon,
  ListOrderedIcon,
  MountainIcon,
  RefreshCwIcon,
  RepeatIcon,
  RulerIcon,
  ScaleIcon,
  SparklesIcon,
  SquarePenIcon,
  TargetIcon,
  TrendingUpIcon,
  TrophyIcon,
  WavesIcon,
  WifiOffIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { CoachChatList } from "@/components/coach-chat-list.tsx";
import { CoachComposer, type MentionableActivity } from "@/components/coach-composer.tsx";
import { CoachMarkdown, type ActivityLookup } from "@/components/coach-markdown.tsx";
import { CoachVisual } from "@/components/coach-visual.tsx";
import {
  BriefChangeCard,
  PlanChangeCard,
  PlanChangeProvider,
  usePlanChanges,
} from "@/components/coach-plan-change.tsx";
import { CoachKeyPrompt, useCoachAvailable } from "@/components/coach-key.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { applyPlanChangeDef, changeCoachBriefDef } from "@/services/coach-tools.ts";
import {
  coachChatQueryKey,
  coachChatsQueryOptions,
  homeQueryOptions,
  powerFilesQueryOptions,
} from "@/lib/queries.ts";
import { withActivityLinks } from "@/services/coach-mentions.ts";
import { powerFileTitle } from "@/services/power-file.ts";
import { isSportTypeShown, sportTypeColor } from "@/services/athlete-settings.types.ts";
import { coachErrorMessage } from "@/lib/coach-errors.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
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

type Starter = { text: string; icon: LucideIcon };

const STARTERS: Starter[] = [
  { text: "How did my last run go?", icon: ActivityIcon },
  { text: "Am I fresh enough for a hard session tomorrow?", icon: BatteryMediumIcon },
  { text: "What are my best 5 km times this year?", icon: TrophyIcon },
];

/** Offered when the athlete came from "Ask the coach" on a power file. */
const POWER_FILE_STARTERS: Starter[] = [
  { text: "What does my pedaling say, and what should I change?", icon: ZapIcon },
  { text: "Is my left/right balance something to work on?", icon: ScaleIcon },
  { text: "Where on the pedal do I push, and should I move my cleats?", icon: TargetIcon },
];

/** Offered when the athlete came from "Ask the coach to change my plan". */
const PLAN_STARTERS: Starter[] = [
  { text: "I can only run twice this week", icon: CalendarMinusIcon },
  { text: "This week feels too hard", icon: GaugeIcon },
  { text: "I can only run on a treadmill this week", icon: RepeatIcon },
];

const TOOL_STEPS: Record<string, { running: string; done: string; icon: LucideIcon }> = {
  find_activities: {
    running: "Finding activities",
    done: "Found activities",
    icon: CalendarSearchIcon,
  },
  get_activity: { running: "Reading the activity", done: "Read the activity", icon: ActivityIcon },
  find_power_files: { running: "Finding power files", done: "Found power files", icon: ZapIcon },
  get_power_file: { running: "Reading the power file", done: "Read the power file", icon: ZapIcon },
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
  load_skill: {
    running: "Reading the coaching guide",
    done: "Read the coaching guide",
    icon: BookOpenIcon,
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
  | { kind: "change"; call: ToolCall }
  | { kind: "brief"; call: ToolCall };

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
    } else if (part.type === "tool-call" && part.name === "change_coach_brief") {
      blocks.push({ kind: "brief", call: part });
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
      <Message align="end" className="text-sm">
        <MessageContent>
          <Bubble variant="secondary" align="end" className="max-w-[85%]">
            <BubbleContent className="rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">
              <CoachMarkdown markdown={text} lookup={lookup} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  const failed = failedCalls(message.parts);
  const blocks = blocksOf(message.parts);
  const reply = blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n\n");
  return (
    <Message className="text-sm">
      <MessageContent className="gap-3">
        <MessageHeader className="gap-2 px-0 text-xs text-foreground">
          <CoachAvatar />
          Coach
        </MessageHeader>
        {live && !blocks.length ? <CoachThinking /> : null}
        {blocks.map((block, index) => (
          <Fragment key={index}>
            {block.kind === "text" ? <CoachMarkdown markdown={block.text} lookup={lookup} /> : null}
            {block.kind === "thinking" ? <ThinkingTrace text={block.text} /> : null}
            {block.kind === "tools" ? (
              <ToolTrace calls={block.calls} failed={failed} live={live} />
            ) : null}
            {block.kind === "visual" ? <VisualBlock call={block.call} live={live} /> : null}
            {block.kind === "change" ? <PlanChangeCard call={block.call} /> : null}
            {block.kind === "brief" ? <BriefChangeCard call={block.call} /> : null}
          </Fragment>
        ))}
        {!live && reply ? (
          <MessageFooter className="-ml-2 px-0">
            <CopyButton text={reply} />
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function CoachAvatar() {
  return (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full"
    >
      <SparklesIcon className="size-3.5" />
    </span>
  );
}

/** Shown between sending and the coach's first word, so a slow model never looks stuck. */
function CoachThinking() {
  return (
    <Trace aria-live="polite">
      <TraceLine status="running">
        <TraceTitle className="text-sm">Thinking…</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground max-sm:h-[2.75rem]"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        )
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy"}
    </Button>
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
/** A power file brought in from its page, as a chip like an activity's. */
function usePowerFileMention(fileId: string | undefined): MentionableActivity | undefined {
  const { data } = useQuery({ ...powerFilesQueryOptions, enabled: Boolean(fileId) });
  return useMemo(() => {
    const file = fileId ? data?.find((item) => item.id === fileId) : undefined;
    if (!file) return undefined;
    const name = powerFileTitle(file);
    return { id: file.id, name, sportType: file.sportType, start: file.start, powerFile: true };
  }, [data, fileId]);
}

export function CoachChat({
  threadId,
  initialActivityId,
  initialPowerFileId,
  initialQuestion,
  onInitialSent,
  planChange = false,
}: {
  threadId: string;
  initialActivityId?: string;
  /** Opened from "Ask the coach" on a power file: the file is brought in. */
  initialPowerFileId?: string;
  /** A question to start from, asked from a section of a power file. */
  initialQuestion?: string;
  /** The activity, power file, or question brought in went out with the first message. */
  onInitialSent: () => void;
  /** Opened from "Ask the coach to change my plan": offer plan changes to start with. */
  planChange?: boolean;
}) {
  const online = useOnline();
  const { shown, byId } = useMentionableActivities();
  const coach = useCoachAvailable("chat");
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
    // The approval the coach asks for on a plan or brief change binds to these definitions.
    tools: [applyPlanChangeDef, changeCoachBriefDef],
  });

  const lookup = useCallback<ActivityLookup>((id) => byId.get(id), [byId]);
  const powerFile = usePowerFileMention(initialPowerFileId);
  const initialMentions = useMemo<MentionableActivity[]>(() => {
    const activity = initialActivityId ? byId.get(initialActivityId) : undefined;
    return [activity, powerFile].filter((item) => item != null);
  }, [byId, initialActivityId, powerFile]);

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
    if (initialActivityId || initialPowerFileId || initialQuestion) onInitialSent();
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
  const starters = planChange ? PLAN_STARTERS : powerFile ? POWER_FILE_STARTERS : STARTERS;
  const { data: chats } = useQuery(coachChatsQueryOptions);
  const title = chats?.find((chat) => chat.id === threadId)?.title;
  // Between sending and the reply's first part, the transcript ends on the question.
  const waiting = isLoading && messages.at(-1)?.role === "user";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        className="mx-auto w-full max-w-3xl"
        icon={SparklesIcon}
        title="Coach"
        description={title && messages.length ? title : undefined}
        actions={
          <>
            <CoachChatList currentId={threadId} />
            {messages.length ? (
              <Button
                variant="outline"
                size="sm"
                className="max-sm:size-[2.75rem] max-sm:px-0"
                nativeButton={false}
                render={<Link to="/coach" search={{}} />}
              >
                <SquarePenIcon />
                <span className="max-sm:sr-only">New chat</span>
              </Button>
            ) : null}
          </>
        }
      />

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
            The coach answers on your own key for your chat model. Add it once to ask about your
            training.
          </CoachKeyPrompt>
        ) : empty ? (
          // Centred: the composer below already sits at the thumb, and a bottom-aligned hero left a
          // blank half screen under the title.
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 overflow-y-auto pb-4">
            <div className="flex flex-col items-center gap-3 text-center text-balance">
              <span
                aria-hidden
                className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-2xl shadow-sm"
              >
                <SparklesIcon className="size-6" />
              </span>
              <h2 className="text-xl font-semibold tracking-tight">Ask the coach</h2>
              <p className="text-muted-foreground max-w-sm text-sm">
                {powerFile
                  ? "Ask what a number of this power file means, whether it's normal for you, and what to change."
                  : "Ask about any activity, your form, or your plan. Type @ to point at an activity."}
              </p>
            </div>
            {/* A starter would send without the activity "Ask about this activity" brought in, and
                competes with a question asked from a power file's section. */}
            {(initialMentions.length > 0 && !powerFile) || initialQuestion ? null : (
              <div className="grid gap-2 sm:grid-cols-3">
                {starters.map((starter) => (
                  <Button
                    key={starter.text}
                    variant="outline"
                    className="bg-card h-auto min-h-12 w-full items-start justify-start gap-3 rounded-xl p-3 text-left text-sm font-normal whitespace-normal sm:flex-col sm:gap-2"
                    disabled={!canSend}
                    onClick={() => send(withActivityLinks(starter.text, initialMentions))}
                  >
                    <starter.icon aria-hidden className="text-muted-foreground mt-0.5 size-4" />
                    {starter.text}
                  </Button>
                ))}
              </div>
            )}
          </div>
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
                    {waiting ? (
                      <MessageScrollerItem>
                        <CoachMessage
                          message={{ id: "waiting", role: "assistant", parts: [] }}
                          lookup={lookup}
                          live
                        />
                      </MessageScrollerItem>
                    ) : null}
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
          key={`${initialActivityId}-${initialPowerFileId}-${initialMentions.length}`}
          activities={shown}
          initialMentions={initialMentions}
          initialText={initialQuestion}
          disabled={!canSend}
          placeholder={
            awaitingAnswer
              ? "Apply or decline the change above, then ask the coach again."
              : !online
                ? "You're offline. You can read this chat; the coach answers once you're back online."
                : needsKey
                  ? "Add the key your chat model needs in Settings → Coach to ask the coach."
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
