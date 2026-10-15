"use client";

import { memo } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { parseCoachMarkdown, type CoachSection } from "#/services/activity-analysis.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export function assistantText(parts: readonly unknown[]) {
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

export const CoachWriteup = memo(function CoachWriteup({ markdown }: { markdown: string }) {
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
});
