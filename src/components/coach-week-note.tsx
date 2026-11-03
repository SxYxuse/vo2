"use client";

import { Suspense, lazy, useState } from "react";
import { SendIcon } from "lucide-react";

import { useCoachAvailable } from "@/components/coach-key.tsx";
import { useOnline } from "@/hooks/use-online.ts";
import { WEEK_NOTE_CHOICES, weekNoteMessage } from "@/services/coach-plan-change.ts";
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
 * A note on a week of the coach plan (GLOSSARY: Coach note): a quick choice or the athlete's own
 * words, sent to the coach, who proposes a change to the week's sessions the athlete applies
 * (ADR 0038). It names the week, not a day: the sessions have none (ADR 0048).
 */
export function CoachWeekNote({
  weekStart,
  title,
  disabledReason,
}: {
  weekStart: string;
  /** "This week", or "Week of 22 Jun". */
  title: string;
  disabledReason?: string;
}) {
  const online = useOnline();
  const { needsKey } = useCoachAvailable();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const reason = !online
    ? "You're offline: notes reach the coach once you're back online."
    : needsKey
      ? "Add your OpenRouter key in Settings → Coach to send the coach a note."
      : disabledReason;
  const send = (note: string) => {
    setSent(weekNoteMessage(weekStart, note));
    setText("");
  };
  return (
    <section aria-label="Note for the coach" className="flex flex-col gap-2 border-t pt-3">
      <p className="text-muted-foreground text-xs">Something changed? Tell the coach</p>
      <div className="flex flex-wrap gap-1.5">
        {WEEK_NOTE_CHOICES.map((choice) => (
          <Button
            key={choice.id}
            size="sm"
            variant="outline"

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
          placeholder="Or in your own words"
          value={text}
          maxLength={500}
          rows={1}
          disabled={reason != null}
          onChange={(event) => setText(event.target.value)}
          className="min-h-7 flex-1 py-1 max-sm:min-h-10 max-sm:py-2"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send the note"
          disabled={reason != null || !text.trim()}
        >
          <SendIcon />
        </Button>
      </form>
      {reason ? <p className="text-muted-foreground text-xs">{reason}</p> : null}
      <ResponsiveDialog open={sent != null} onOpenChange={(open) => !open && setSent(null)}>
        <ResponsiveDialogContent className="sm:max-w-lg" showCloseButton={false}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
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
            <ResponsiveDialogClose render={<Button variant="outline" />}>
              Close
            </ResponsiveDialogClose>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </section>
  );
}
