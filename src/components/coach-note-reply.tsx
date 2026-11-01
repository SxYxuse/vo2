"use client";

import { useEffect, useRef, useState } from "react";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";

import { CoachMessage } from "@/components/coach-chat.tsx";
import { PlanChangeProvider, usePlanChanges } from "@/components/coach-plan-change.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { applyPlanChangeDef } from "@/services/coach-tools.ts";
import { coachErrorMessage } from "@/lib/coach-errors.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

const noActivity = () => undefined;

/**
 * One note's conversation with the coach, outside the coach chat: the coach proposes a change and
 * the athlete applies or declines it here. Kept in memory only, so closing drops it.
 */
export function NoteReply({ message }: { message: string }) {
  const online = useOnline();
  const [connection] = useState(() => fetchServerSentEvents("/api/coach"));
  const [threadId] = useState(() => `plan-note-${crypto.randomUUID()}`);
  const { messages, sendMessage, isLoading, error, interrupts, resuming } = useChat({
    connection,
    threadId,
    forwardedProps: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    // The approval the coach asks for on a plan change binds to this definition.
    tools: [applyPlanChangeDef],
  });
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void sendMessage(message);
  }, [message, sendMessage]);
  const changes = usePlanChanges(messages, interrupts, online && !isLoading && !resuming);
  const replies = messages.filter((item) => item.role === "assistant");
  return (
    <PlanChangeProvider value={changes}>
      <div className="flex max-h-[60dvh] min-h-24 flex-col gap-3 overflow-y-auto px-4 sm:px-0">
        {replies.map((reply, index) => (
          <CoachMessage
            key={reply.id}
            message={reply}
            lookup={noActivity}
            live={isLoading && index === replies.length - 1}
          />
        ))}
        {isLoading && !replies.length ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner />
            The coach is looking at your plan…
          </p>
        ) : null}
        {error && !isLoading ? (
          <Alert variant="destructive">
            <AlertTitle>The coach could not answer</AlertTitle>
            <AlertDescription>{coachErrorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </PlanChangeProvider>
  );
}
