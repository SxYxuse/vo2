"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchServerSentEvents, indexedDBPersistence, useChat } from "@tanstack/ai-react";
import type { UIMessage } from "@tanstack/ai-react";
import {
  ActivityIcon,
  CalendarSearchIcon,
  ChartLineIcon,
  FlagIcon,
  GaugeIcon,
  HeartPulseIcon,
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
  type LucideIcon,
} from "lucide-react";

import { CoachComposer, type MentionableActivity } from "@/components/coach-composer.tsx";
import { CoachMarkdown, type ActivityLookup } from "@/components/coach-markdown.tsx";
import { CoachVisual } from "@/components/coach-visual.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { homeQueryOptions } from "@/lib/queries.ts";
import { isSportTypeShown, sportTypeColor } from "@/services/athlete-settings.types.ts";
import { COACH_DATABASE } from "@/lib/coach-storage.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
};

type Part = UIMessage["parts"][number];
type ToolCall = Extract<Part, { type: "tool-call" }>;
type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tools"; calls: ToolCall[] }
  | { kind: "visual"; call: ToolCall };

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

function ToolTrace({ calls, failed }: { calls: ToolCall[]; failed: Set<string> }) {
  const running = calls.some((call) => call.state !== "complete" && call.output === undefined);
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
              const done = call.state === "complete" || call.output !== undefined;
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

function VisualBlock({ call }: { call: ToolCall }) {
  const input = call.input as { title?: unknown; html?: unknown } | undefined;
  const ready =
    call.state !== "awaiting-input" &&
    call.state !== "input-streaming" &&
    typeof input?.html === "string";
  if (!ready) {
    return (
      <Trace>
        <TraceLine status="running">
          <TraceIcon>
            <ChartLineIcon />
          </TraceIcon>
          <TraceTitle>Drawing a visual</TraceTitle>
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

function CoachMessage({ message, lookup }: { message: UIMessage; lookup: ActivityLookup }) {
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
            {block.kind === "tools" ? <ToolTrace calls={block.calls} failed={failed} /> : null}
            {block.kind === "visual" ? <VisualBlock call={block.call} /> : null}
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

function NewChatButton({ onConfirm, disabled }: { onConfirm: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        <SquarePenIcon />
        New chat
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start a new chat?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the conversation with the coach on this device. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            Delete and start over
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The coach chat: one conversation, kept in this browser so it reopens where it was left and
 * still reads offline.
 */
export function CoachChat({
  initialActivityId,
  onInitialActivitySent,
}: {
  initialActivityId?: string;
  onInitialActivitySent: () => void;
}) {
  const online = useOnline();
  const { shown, byId } = useMentionableActivities();
  const [persistence] = useState(() => indexedDBPersistence({ databaseName: COACH_DATABASE }));
  const [connection] = useState(() => fetchServerSentEvents("/api/coach"));
  const { messages, sendMessage, isLoading, error, stop, reload, clear, isHydrating } = useChat({
    connection,
    // One chat per device: sign-out deletes it, so the next athlete starts fresh.
    threadId: "coach",
    persistence,
    forwardedProps: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });

  const lookup = useCallback<ActivityLookup>((id) => byId.get(id), [byId]);
  const initialMentions = useMemo<MentionableActivity[]>(() => {
    const activity = initialActivityId ? byId.get(initialActivityId) : undefined;
    return activity ? [activity] : [];
  }, [byId, initialActivityId]);

  const send = (message: string) => {
    void sendMessage(message);
    if (initialActivityId) onInitialActivitySent();
  };
  const empty = !messages.length && !isHydrating;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <SparklesIcon aria-hidden className="size-5" />
          Coach
        </h1>
        <NewChatButton onConfirm={clear} disabled={!messages.length || isLoading} />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {empty ? (
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
            <EmptyContent className="flex-col">
              {STARTERS.map((starter) => (
                <Button
                  key={starter}
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start py-2 text-left whitespace-normal sm:min-h-8"
                  disabled={!online}
                  onClick={() => send(starter)}
                >
                  {starter}
                </Button>
              ))}
            </EmptyContent>
          </Empty>
        ) : (
          <MessageScrollerProvider>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="mx-auto w-full max-w-3xl pb-4">
                  {messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <CoachMessage message={message} lookup={lookup} />
                    </MessageScrollerItem>
                  ))}
                  {error && !isLoading ? (
                    <MessageScrollerItem>
                      <Alert variant="destructive">
                        <AlertTitle>The coach could not answer</AlertTitle>
                        <AlertDescription>{error.message}</AlertDescription>
                        <AlertAction>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!online}
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
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl shrink-0">
        <CoachComposer
          // The activities may still be loading on first paint; start again once it's known.
          key={`${initialActivityId}-${initialMentions.length}`}
          activities={shown}
          initialMentions={initialMentions}
          disabled={!online}
          placeholder={
            online
              ? "Ask the coach… (@ to mention an activity)"
              : "You're offline. You can read this chat; the coach answers once you're back online."
          }
          busy={isLoading}
          onSend={send}
          onStop={stop}
        />
      </div>
    </div>
  );
}
