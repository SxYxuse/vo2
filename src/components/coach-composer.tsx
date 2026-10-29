"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { format } from "date-fns";
import { ArrowUpIcon, AtSignIcon, SquareIcon, XIcon } from "lucide-react";

import { SPORT_STYLE } from "@/components/sport-style.ts";
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { withActivityLinks, type ActivityMention } from "@/services/coach-mentions.ts";
import { sportGroupFor } from "@/services/sport-groups.ts";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

export type MentionableActivity = ActivityMention & {
  sportType: string;
  start: string;
  color?: string;
};

const MAX_SUGGESTIONS = 8;
/** 44px on phones, like the sidebar footer, so the buttons are easy to tap. */
const TOUCH_BUTTON = "max-sm:size-[2.75rem] max-sm:[&_svg]:size-4";
const MAX_QUERY = 40;

function sportIcon(sportType: string) {
  return SPORT_STYLE[sportGroupFor(sportType)?.id ?? "other"].icon;
}

function dayLabel(start: string) {
  return format(new Date(start), "EEE d MMM yyyy");
}

/** The `@query` being typed right before the caret, unless it was already closed. */
function mentionQuery(text: string, caret: number, closedAt: number | null) {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1 || at === closedAt) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || query.includes("\n")) return null;
  return { at, query };
}

function matches(activity: MentionableActivity, query: string) {
  const haystack =
    `${activity.name} ${dayLabel(activity.start)} ${formatSportType(activity.sportType)}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function MentionChip({
  activity,
  onRemove,
}: {
  activity: MentionableActivity;
  onRemove: () => void;
}) {
  const Icon = sportIcon(activity.sportType);
  return (
    <Attachment size="sm">
      <AttachmentMedia style={activity.color ? { color: activity.color } : undefined}>
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{activity.name}</AttachmentTitle>
        <AttachmentDescription>{dayLabel(activity.start)}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={`Remove ${activity.name}`}
          className="max-sm:size-8"
          onClick={onRemove}
        >
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

/**
 * The coach chat's message box. Typing @ lists the athlete's activities; a pick becomes a chip
 * and, on send, a link the coach can read.
 */
export function CoachComposer({
  activities,
  initialMentions = [],
  disabled,
  placeholder,
  busy,
  onSend,
  onStop,
}: {
  activities: readonly MentionableActivity[];
  initialMentions?: readonly MentionableActivity[];
  disabled: boolean;
  placeholder: string;
  busy: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [mentions, setMentions] = useState<MentionableActivity[]>([...initialMentions]);
  const [highlighted, setHighlighted] = useState<string>("");

  const mention = mentionQuery(text, caret, closedAt);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    return activities
      .filter((activity) => !mentions.some((picked) => picked.id === activity.id))
      .filter((activity) => matches(activity, mention.query))
      .slice(0, MAX_SUGGESTIONS);
  }, [activities, mention, mentions]);
  const open = mention != null && !disabled;
  const selected = suggestions.find((activity) => activity.id === highlighted) ?? suggestions[0];

  const syncCaret = () => setCaret(textarea.current?.selectionStart ?? text.length);

  const pick = (activity: MentionableActivity) => {
    if (!mention) return;
    const token = `@${activity.name} `;
    const next = text.slice(0, mention.at) + token + text.slice(caret);
    const nextCaret = mention.at + token.length;
    setText(next);
    setCaret(nextCaret);
    setClosedAt(mention.at);
    setMentions((current) => [...current, activity]);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertAt = () => {
    const field = textarea.current;
    const at = field?.selectionStart ?? text.length;
    const prefix = at > 0 && !/\s/.test(text[at - 1]) ? " @" : "@";
    const next = text.slice(0, at) + prefix + text.slice(at);
    setText(next);
    setCaret(at + prefix.length);
    setClosedAt(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + prefix.length, at + prefix.length);
    });
  };

  const send = () => {
    const message = withActivityLinks(text.trim(), mentions);
    if (!message || busy || disabled) return;
    onSend(message);
    setText("");
    setCaret(0);
    setClosedAt(null);
    setMentions([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && suggestions.length) {
      const index = selected ? suggestions.indexOf(selected) : 0;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = (index + step + suggestions.length) % suggestions.length;
        setHighlighted(suggestions[next].id);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && selected) {
        event.preventDefault();
        pick(selected);
        return;
      }
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      setClosedAt(mention.at);
      return;
    }
    // Enter sends on a keyboard; phones keep Enter for a new line and send with the button.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="relative">
      {open ? (
        <Command
          shouldFilter={false}
          value={selected?.id ?? ""}
          onValueChange={setHighlighted}
          // Floats over the transcript, so the message box never moves while picking.
          className="bg-popover absolute inset-x-0 bottom-full z-10 mb-2 h-auto max-h-64 rounded-lg border shadow-md"
          aria-label="Activities to mention"
        >
          <CommandList>
            <CommandEmpty>No activity matches “{mention.query}”.</CommandEmpty>
            {suggestions.map((activity) => {
              const Icon = sportIcon(activity.sportType);
              return (
                <CommandItem
                  key={activity.id}
                  value={activity.id}
                  onSelect={() => pick(activity)}
                  // Keep focus in the message box, so the keyboard stays up on phones.
                  onMouseDown={(event) => event.preventDefault()}
                  className="min-h-11 sm:min-h-8"
                >
                  <Icon style={activity.color ? { color: activity.color } : undefined} />
                  <span className="min-w-0 flex-1 truncate">{activity.name}</span>
                  <span className="text-muted-foreground shrink-0">{dayLabel(activity.start)}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      ) : null}
      <InputGroup>
        {mentions.length ? (
          <InputGroupAddon align="block-start">
            <AttachmentGroup className="w-full">
              {mentions.map((activity) => (
                <MentionChip
                  key={activity.id}
                  activity={activity}
                  onRemove={() => {
                    setMentions((current) => current.filter((item) => item.id !== activity.id));
                    setText((current) => current.replace(`@${activity.name}`, activity.name));
                  }}
                />
              ))}
            </AttachmentGroup>
          </InputGroupAddon>
        ) : null}
        <InputGroupTextarea
          ref={textarea}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="max-h-40 min-h-11 text-base sm:text-sm"
          aria-label="Message the coach"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={syncCaret}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <InputGroupButton
            size="icon-sm"
            className={TOUCH_BUTTON}
            variant="ghost"
            aria-label="Mention an activity"
            disabled={disabled}
            onClick={insertAt}
          >
            <AtSignIcon />
          </InputGroupButton>
          {busy ? (
            <InputGroupButton
              size="icon-sm"
              className={TOUCH_BUTTON}
              variant="default"
              aria-label="Stop"
              onClick={onStop}
            >
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              size="icon-sm"
              className={TOUCH_BUTTON}
              variant="default"
              aria-label="Send"
              disabled={disabled || !text.trim()}
              onClick={send}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
