"use client";

import { Suspense, lazy, useState } from "react";
import { format, parseISO } from "date-fns";
import { SendIcon } from "lucide-react";

import { useCoachAvailable } from "@/components/coach-key.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { DAY_NOTE_CHOICES, dayNoteMessage } from "@/services/coach-plan-change.ts";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

// The reply carries the chat's rendering; loaded when a note is sent, so Plan stays light.
const NoteReply = lazy(() =>
  import("@/components/coach-note-reply.tsx").then((module) => ({ default: module.NoteReply })),
);

/**
 * A note on a day of the coach plan (GLOSSARY: Coach note): a quick choice or the athlete's own
 * words, sent to the coach, who proposes a plan change the athlete applies (ADR 0038).
 */
export function CoachDayNote({ date, disabledReason }: { date: string; disabledReason?: string }) {
  const online = useOnline();
  const { needsKey } = useCoachAvailable();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const reason = !online
    ? "You're offline: notes reach the coach once you're back online."
    : needsKey
      ? "Add your OpenRouter key in Settings → Coach to send the coach a note."
      : disabledReason;
  const weekday = format(parseISO(date), "EEEE");
  const send = (note: string) => {
    setSent(dayNoteMessage(date, weekday, note));
    setText("");
  };
  return (
    <section aria-label="Note for the coach" className="flex flex-col gap-2 border-t pt-3">
      <p className="text-muted-foreground text-xs">Something changed? Tell the coach</p>
      <div className="flex flex-wrap gap-1.5">
        {DAY_NOTE_CHOICES.map((choice) => (
          <Button
            key={choice.id}
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            disabled={reason != null}
            onClick={() => send(choice.text)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) send(text);
        }}
      >
        <Textarea
          aria-label="Your note"
          placeholder={`Or in your own words, about ${weekday}`}
          value={text}
          maxLength={500}
          rows={1}
          disabled={reason != null}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 flex-1 sm:min-h-9"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send the note"
          className="size-11 sm:size-9"
          disabled={reason != null || !text.trim()}
        >
          <SendIcon />
        </Button>
      </form>
      {reason ? <p className="text-muted-foreground text-xs">{reason}</p> : null}
      <ResponsiveDialog open={sent != null} onOpenChange={(open) => !open && setSent(null)}>
        <ResponsiveDialogContent className="sm:max-w-lg" showCloseButton={false}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{format(parseISO(date), "EEEE d MMMM")}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              The coach proposes a change; nothing changes until you apply it.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {sent ? (
            <Suspense fallback={<Spinner className="mx-4 sm:mx-0" />}>
              <NoteReply key={sent} message={sent} />
            </Suspense>
          ) : null}
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose render={<Button variant="outline" className="min-h-11" />}>
              Close
            </ResponsiveDialogClose>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </section>
  );
}
