"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function ActivityDetailSection({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible render={<Card size="sm" />}>
      <CollapsibleTrigger
        nativeButton={false}
        render={<CardHeader />}
        className="group/section cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <CardTitle className="flex flex-wrap items-center gap-2">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        <CardAction className="flex items-center justify-center self-center">
          <ChevronDownIcon
            aria-hidden
            className="size-4 text-muted-foreground transition-transform group-data-panel-open/section:rotate-180"
          />
        </CardAction>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </CollapsibleContent>
    </Collapsible>
  );
}
