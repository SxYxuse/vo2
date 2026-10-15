"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  ActivityIcon,
  GaugeIcon,
  HeartPulseIcon,
  MountainIcon,
  PenLineIcon,
  SparklesIcon,
  WavesIcon,
  type LucideIcon,
} from "lucide-react";

import { saveActivityAnalysis } from "#/services/activity-analysis.ts";
import { activityAnalysisQueryOptions } from "#/lib/queries.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { CoachWriteup, assistantText } from "#/components/activity-analysis-writeup.tsx";

const TOOL_STEPS: Record<string, { running: string; done: string; icon: LucideIcon }> = {
  get_activity_overview: {
    running: "Reading activity stats",
    done: "Read activity stats",
    icon: ActivityIcon,
  },
  detect_elevation_segments: {
    running: "Finding climbs and descents",
    done: "Found climbs and descents",
    icon: MountainIcon,
  },
  correlate_streams: {
    running: "Correlating elevation, heart rate, and speed",
    done: "Correlated elevation, heart rate, and speed",
    icon: HeartPulseIcon,
  },
  summarize_effort_phases: {
    running: "Splitting effort by grade",
    done: "Split effort by grade",
    icon: GaugeIcon,
  },
};

const ANALYZE_PROMPT =
  "Analyze this activity. Call every stream tool you need. Correlate heart rate with elevation and grade, detect when the athlete is gaining elevation, and explain effort on climbs versus the flat.";

type ToolCallPart = {
  id?: string;
  name?: string;
  state?: string;
};

function toolStep(part: ToolCallPart) {
  return (
    TOOL_STEPS[part.name ?? ""] ?? {
      running: part.name ?? "Running tool",
      done: part.name ?? "Ran tool",
      icon: SparklesIcon,
    }
  );
}

function AnalysisWorkTrace({
  toolParts,
  writing,
}: {
  toolParts: readonly ToolCallPart[];
  writing: boolean;
}) {
  const toolsStarted = toolParts.length > 0;
  return (
    <Trace aria-live="polite">
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status="running">
            <TraceIcon>
              <SparklesIcon />
            </TraceIcon>
            <TraceTitle>Analyzing this activity</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {!toolsStarted ? (
              <TraceLine status="running">
                <TraceIcon>
                  <WavesIcon />
                </TraceIcon>
                <TraceTitle>Reading streams</TraceTitle>
              </TraceLine>
            ) : null}
            {toolParts.map((part, index) => {
              const done = part.state === "complete";
              const step = toolStep(part);
              const Icon = step.icon;
              return (
                <TraceLine
                  key={part.id ?? `${part.name}-${index}`}
                  status={done ? undefined : "running"}
                >
                  <TraceIcon>
                    <Icon />
                  </TraceIcon>
                  <TraceTitle>{done ? step.done : step.running}</TraceTitle>
                </TraceLine>
              );
            })}
            {writing ? (
              <TraceLine status="running">
                <TraceIcon>
                  <PenLineIcon />
                </TraceIcon>
                <TraceTitle>Writing coach note</TraceTitle>
              </TraceLine>
            ) : null}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export function ActivityAnalysisLive({
  activityId,
  onBusyChange,
}: {
  activityId: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const started = useRef(false);
  const connection = useMemo(
    () =>
      fetchServerSentEvents(`/api/activity-analysis?activityId=${encodeURIComponent(activityId)}`),
    [activityId],
  );
  const { messages, sendMessage, isLoading, error, stop } = useChat({
    connection,
    threadId: `activity-${activityId}`,
    onFinish: (message) => {
      const body = assistantText(message.parts);
      if (body.length < 24) return;
      void saveActivityAnalysis({ data: { activityId, body } }).then((saved) => {
        if (!saved) return;
        queryClient.setQueryData(activityAnalysisQueryOptions(activityId).queryKey, saved);
      });
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sendMessage(ANALYZE_PROMPT);
  }, [sendMessage]);

  useEffect(() => {
    onBusyChange(isLoading);
    return () => onBusyChange(false);
  }, [isLoading, onBusyChange]);

  const liveBody = assistantText(
    messages.filter((message) => message.role === "assistant").flatMap((message) => message.parts),
  );
  const toolParts = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "tool-call");
  const toolsRunning = toolParts.some((part) => part.state !== "complete");
  const writing = isLoading && (Boolean(liveBody) || (toolParts.length > 0 && !toolsRunning));

  return (
    <div className="flex flex-col gap-3 py-1">
      {isLoading ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => stop()}>
            <Spinner data-icon="inline-start" />
            Stop
          </Button>
        </div>
      ) : null}
      {isLoading ? <AnalysisWorkTrace toolParts={toolParts} writing={writing} /> : null}
      {liveBody ? <CoachWriteup markdown={liveBody} /> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
