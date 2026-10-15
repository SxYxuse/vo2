"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { formatDistanceToNow } from "date-fns";
import { SparklesIcon, TriangleAlertIcon } from "lucide-react";

import {
  parseCoachMarkdown,
  saveActivityAnalysis,
  type CoachSection,
} from "#/services/activity-analysis.ts";
import { activityAnalysisQueryOptions, analysisStatusQueryOptions } from "#/lib/queries.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const TOOL_LABELS: Record<string, string> = {
  get_activity_overview: "Reading activity stats",
  detect_elevation_segments: "Finding climbs and descents",
  correlate_streams: "Correlating elevation, heart rate, and speed",
  summarize_effort_phases: "Splitting effort by grade",
};

const ANALYZE_PROMPT =
  "Analyze this activity. Call every stream tool you need. Correlate heart rate with elevation and grade, detect when the athlete is gaining elevation, and explain effort on climbs versus the flat.";

function assistantText(parts: readonly unknown[]) {
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (!("type" in part) || part.type !== "text") return "";
      if (!("content" in part) || typeof part.content !== "string") return "";
      return part.content;
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function RichText({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    return <span key={index}>{part}</span>;
  });
}

function CoachBlocks({ blocks }: { blocks: CoachSection["blocks"] }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) =>
        block.type === "ul" ? (
          <ul key={index} className="flex list-disc flex-col gap-1.5 ps-4">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <RichText text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <RichText text={block.text} />
          </p>
        ),
      )}
    </div>
  );
}

function CoachWriteup({ markdown }: { markdown: string }) {
  const sections = parseCoachMarkdown(markdown);
  return (
    <div className="flex flex-col gap-4 text-sm/relaxed">
      {sections.map((section, index) => {
        const watchOut = Boolean(section.title?.toLowerCase().includes("watch"));
        if (watchOut) {
          return (
            <Alert key={index} variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>{section.title}</AlertTitle>
              <AlertDescription>
                <CoachBlocks blocks={section.blocks} />
              </AlertDescription>
            </Alert>
          );
        }
        return (
          <section key={index} className="flex flex-col gap-2">
            {index > 0 ? <Separator /> : null}
            {section.title ? (
              <h3 className="font-heading text-sm font-medium">{section.title}</h3>
            ) : null}
            <CoachBlocks blocks={section.blocks} />
          </section>
        );
      })}
    </div>
  );
}

export function ActivityAnalysisCard({
  activityId,
  hasStreams,
}: {
  activityId: string;
  hasStreams: boolean;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(analysisStatusQueryOptions);
  const savedQuery = useQuery({
    ...activityAnalysisQueryOptions(activityId),
    enabled: Boolean(activityId),
  });
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

  const liveBody = assistantText(
    messages.filter((message) => message.role === "assistant").flatMap((message) => message.parts),
  );
  const toolParts = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "tool-call");
  const saved = savedQuery.data;
  const body = isLoading ? liveBody : liveBody || saved?.body || "";
  const mocked = saved?.mocked ?? statusQuery.data?.mocked ?? false;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>AI analysis</CardTitle>
        <CardDescription>
          {saved && !isLoading
            ? `Saved ${formatDistanceToNow(new Date(saved.updatedAt), { addSuffix: true })}. Run again only if you want a fresh read.`
            : "Coach note of intensity, pacing, and terrain. Runs only when you ask."}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {mocked ? <Badge variant="warning">Mocked</Badge> : null}
          {isLoading ? (
            <Button variant="outline" onClick={() => stop()}>
              Stop
            </Button>
          ) : (
            <Button
              disabled={!hasStreams}
              onClick={() => {
                void sendMessage(ANALYZE_PROMPT);
              }}
            >
              <SparklesIcon data-icon="inline-start" />
              {saved ? "Analyze again" : "Analyze"}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasStreams ? (
          <Empty className="min-h-36 border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon className="text-ds-purple-700" />
              </EmptyMedia>
              <EmptyTitle>No streams to analyze</EmptyTitle>
              <EmptyDescription>
                This activity has no elevation, heart rate, or speed samples for the tools to read.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : savedQuery.isPending && !isLoading && !body ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !body && !isLoading ? (
          <Empty className="min-h-36 border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon className="text-ds-purple-700" />
              </EmptyMedia>
              <EmptyTitle>Waiting for you</EmptyTitle>
              <EmptyDescription>
                Analyze writes a coach note from streams and keeps it on this activity until you run
                it again.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3 py-1">
            {isLoading ? (
              <div className="flex flex-col gap-1.5">
                {toolParts.length === 0 ? (
                  <Marker>
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>Reading streams…</MarkerContent>
                  </Marker>
                ) : null}
                {toolParts.map((part, index) => {
                  const done = part.state === "complete";
                  return (
                    <Marker key={`${part.id}-${index}`}>
                      {done ? null : (
                        <MarkerIcon>
                          <Spinner />
                        </MarkerIcon>
                      )}
                      <MarkerContent>
                        {TOOL_LABELS[part.name] ?? part.name}
                        {done ? " · done" : "…"}
                      </MarkerContent>
                    </Marker>
                  );
                })}
              </div>
            ) : null}
            {body ? <CoachWriteup markdown={body} /> : null}
          </div>
        )}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Analysis failed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
