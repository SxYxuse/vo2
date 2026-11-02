"use client";

import { useEffect, useRef, useState } from "react";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";

import { CoachMessage } from "@/components/coach-chat.tsx";
import { PlanChangeProvider, usePlanChanges } from "@/components/coach-plan-change.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { applyPlanChangeDef } from "@/services/coach-tools.ts";
import { coachErrorMessage } from "@/lib/coach-errors.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NOTE_THREAD_PREFIX } from "@/services/coach-chats.ts";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const noActivity = () => undefined;

/**
 * One note's conversation with the coach, outside the coach chat: the coach proposes a change and
 * the athlete applies or declines it here. Kept in memory only, so closing drops it.
 */
export function NoteReply({ message }: { message: string }) {
  const online = useOnline();
  const [connection] = useState(() => fetchServerSentEvents("/api/coach"));
  const [threadId] = useState(() => `${NOTE_THREAD_PREFIX}${crypto.randomUUID()}`);
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
  const [reply, setReply] = useState("");
  // The coach may ask a question rather than propose: the athlete answers here. Not while a change
  // waits on Apply or Decline, which takes no new message until answered.
  const canReply = online && !isLoading && !resuming && !interrupts.length;
  return (
    <PlanChangeProvider value={changes}>
      <div className="flex max-h-[60dvh] min-h-24 flex-col gap-3 overflow-y-auto px-4 sm:px-0">
        {messages.slice(1).map((item, index) => (
          <CoachMessage
            key={item.id}
            message={item}
            lookup={noActivity}
            live={isLoading && index === messages.length - 2}
          />
        ))}
        {isLoading && messages.length < 2 ? (
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
      {messages.length > 1 ? (
        <form
          className="flex items-end gap-2 px-4 sm:px-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reply.trim() || !canReply) return;
            void sendMessage(reply.trim());
            setReply("");
          }}
        >
          <Textarea
            aria-label="Reply to the coach"
            placeholder={
              interrupts.length
                ? "Apply or decline the change first."
                : online
                  ? "Reply to the coach"
                  : "You're offline."
            }
            value={reply}
            maxLength={500}
            rows={1}
            disabled={!canReply}
            onChange={(event) => setReply(event.target.value)}
            className="min-h-11 flex-1 sm:min-h-9"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send the reply"
            className="size-11 sm:size-9"
            disabled={!canReply || !reply.trim()}
          >
            <SendIcon />
          </Button>
        </form>
      ) : null}
    </PlanChangeProvider>
  );
}
