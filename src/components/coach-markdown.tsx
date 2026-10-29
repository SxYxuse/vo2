"use client";

import { memo, type ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { Markdown, type MarkdownComponents } from "@tanstack/markdown/react";

import { cn } from "@/lib/utils";
import { activityIdFromHref } from "@/services/coach-mentions.ts";

export type ActivityLookup = (id: string) => { color?: string } | undefined;

function makeComponents(lookup: ActivityLookup): MarkdownComponents {
  return {
    a({ href, children, className, ...props }: ComponentProps<"a">) {
      const activityId = activityIdFromHref(href);
      if (activityId) {
        const color = lookup(activityId)?.color;
        return (
          <Link
            to="/activities/$activityId"
            params={{ activityId }}
            className="not-typeset bg-background hover:bg-muted inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-px align-baseline text-[0.9em] font-medium no-underline transition-colors"
          >
            <span
              aria-hidden
              className="bg-muted-foreground size-2 shrink-0 rounded-full"
              style={color ? { backgroundColor: color } : undefined}
            />
            <span className="truncate">{children}</span>
          </Link>
        );
      }
      const external = href?.startsWith("http") ?? false;
      return (
        <a
          {...props}
          href={href}
          className={className}
          rel={external ? "noopener noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    table({ children, ...props }: ComponentProps<"table">) {
      return (
        <div className="typeset-scroll">
          <table {...props}>{children}</table>
        </div>
      );
    },
  };
}

/**
 * Chat markdown, styled by Typeset. Links to an activity become chips that open it. Raw HTML
 * is never rendered; the coach draws HTML only through a visual.
 */
export const CoachMarkdown = memo(function CoachMarkdown({
  markdown,
  lookup,
  className,
}: {
  markdown: string;
  lookup: ActivityLookup;
  className?: string;
}) {
  return (
    <div className={cn("typeset typeset-chat min-w-0", className)}>
      <Markdown components={makeComponents(lookup)}>{markdown}</Markdown>
    </div>
  );
});
