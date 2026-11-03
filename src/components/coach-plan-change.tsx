"use client";

import { createContext, use, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "@tanstack/ai-react";
import { format, parseISO } from "date-fns";
import { ArrowRightIcon, CalendarCogIcon, CheckIcon, XIcon } from "lucide-react";

import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { cn } from "@/lib/utils";
import { sessionKindLabel } from "@/services/coach-plan.types.ts";
import type {
  ChangeSide,
  PlanChangeApplied,
  PlanChangeProposal,
} from "@/services/coach-plan-change.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type Part = UIMessage["parts"][number];
type ToolCall = Extract<Part, { type: "tool-call" }>;
type Checked = Extract<PlanChangeProposal, { ok: true }>;
type Approval = { toolCallId: string; resolveInterrupt: (approved: boolean) => void };

type PlanChanges = {
  /** Changes VO2 checked in this conversation, by proposal id: the only ones a card shows. */
  proposals: Map<string, Checked>;
  /** Approvals waiting on the athlete, by tool call id. */
  approvals: Map<string, Approval>;
  /** Apply and Decline need the server: off while offline or while the chat is busy. */
  canAnswer: boolean;
};

const PlanChangeContext = createContext<PlanChanges>({
  proposals: new Map(),
  approvals: new Map(),
  canAnswer: false,
});

export const PlanChangeProvider = PlanChangeContext.Provider;

/** The checked proposals and waiting approvals of a conversation, for its change cards. */
export function usePlanChanges(
  messages: readonly UIMessage[],
  interrupts: readonly { kind: string }[],
  canAnswer: boolean,
): PlanChanges {
  return useMemo(() => {
    const proposals = new Map<string, Checked>();
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || part.name !== "propose_plan_change") continue;
        const output = part.output as PlanChangeProposal | undefined;
        if (output?.ok) proposals.set(output.proposalId, output);
      }
    }
    const approvals = new Map(
      interrupts
        .filter((item): item is Approval & { kind: string } => item.kind === "tool-approval")
        .map((item) => [item.toolCallId, item]),
    );
    return { proposals, approvals, canAnswer };
  }, [messages, interrupts, canAnswer]);
}

/** One side of a changed session: what the run is, how long, and its steps; or no run. */
function Side({ side, before }: { side: ChangeSide; before?: boolean }) {
  const label = before ? "Before" : "After";
  if (!side) {
    return (
      <div className="flex min-w-0 flex-col" aria-label={label} role="group">
        <span className="text-muted-foreground font-medium">No run</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5" aria-label={label} role="group">
      <span className={cn("font-medium", before && "text-muted-foreground line-through")}>
        {side.title}
      </span>
      <span className="text-muted-foreground text-xs">
        {sessionKindLabel(side.kind)} · {side.distanceKm} km · about {side.minutes} min
      </span>
      {side.steps.map((line, index) => (
        <span key={index} className="text-muted-foreground text-xs">
          {line}
        </span>
      ))}
    </div>
  );
}

function Outcome({ call }: { call: ToolCall }) {
  const queryClient = useQueryClient();
  const output = call.output as PlanChangeApplied | undefined;
  const applied = output?.applied === true;
  useEffect(() => {
    if (applied) void queryClient.invalidateQueries(coachPlanQueryOptions);
  }, [applied, queryClient]);
  if (output) {
    return output.applied ? (
      <p className="text-success flex items-center gap-1.5 text-sm font-medium">
        <CheckIcon aria-hidden className="size-4" />
        Applied to your plan
      </p>
    ) : (
      <p className="text-destructive text-sm">{output.reason}</p>
    );
  }
  if (call.approval?.approved === false) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <XIcon aria-hidden className="size-4" />
        Declined: your plan stays as it was
      </p>
    );
  }
  if (call.approval?.approved === true) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Spinner />
        Applying…
      </p>
    );
  }
  return null;
}

/**
 * The change the coach offers with apply_plan_change, session by session under its week, with
 * Apply and Decline. It shows only a change VO2 checked in this conversation: an id the checker
 * never answered gets no diff.
 */
export function PlanChangeCard({ call }: { call: ToolCall }) {
  const { proposals, approvals, canAnswer } = use(PlanChangeContext);
  const input = call.input as { proposalId?: unknown } | undefined;
  const proposal =
    typeof input?.proposalId === "string" ? proposals.get(input.proposalId) : undefined;
  const approval = approvals.get(call.id);
  const waiting = approval != null && call.state === "approval-requested";
  return (
    <Card size="sm" role="group" aria-label="Plan change">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCogIcon aria-hidden className="size-4" />
          Change to your plan
        </CardTitle>
        <CardDescription>
          {proposal ? proposal.summary : "This change wasn't checked, so it can't be applied."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {proposal ? (
          <ul className="flex flex-col">
            {proposal.sessions.map((change, index) => (
              <li
                key={index}
                className="flex flex-col gap-1.5 border-t py-2 text-sm first:border-t-0"
              >
                <b className="font-medium">Week of {format(parseISO(change.weekStart), "d MMM")}</b>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
                  <Side side={change.before} before />
                  <ArrowRightIcon aria-label="becomes" className="mt-1 size-3.5" />
                  <Side side={change.after} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {waiting ? (
          <div className="flex gap-2">
            {proposal ? (
              <Button
                className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
                disabled={!canAnswer}
                onClick={() => approval.resolveInterrupt(true)}
              >
                <CheckIcon data-icon="inline-start" />
                Apply
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
              disabled={!canAnswer}
              onClick={() => approval.resolveInterrupt(false)}
            >
              Decline
            </Button>
          </div>
        ) : (
          <Outcome call={call} />
        )}
      </CardContent>
    </Card>
  );
}
