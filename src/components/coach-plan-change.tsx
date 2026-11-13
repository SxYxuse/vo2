"use client";

import { createContext, use, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "@tanstack/ai-react";
import { format, parseISO } from "date-fns";
import {
  CalendarCogIcon,
  CheckIcon,
  ChevronDownIcon,
  MessageSquareTextIcon,
  XIcon,
} from "lucide-react";

import { coachPlanQueryOptions } from "@/lib/queries.ts";
import { cn } from "@/lib/utils";
import {
  minutesText,
  PLAN_SPORTS,
  sessionAmountText,
  type PlanSport,
} from "@/services/coach-plan.types.ts";
import type {
  BriefChangeInput,
  ChangedSession,
  ChangeSide,
  PlanChangeApplied,
  PlanChangeProposal,
} from "@/services/coach-plan-change.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { SPORT_ICON } from "@/components/coach-run.tsx";

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

type Sign = "removed" | "added";
type Row = { sign: Sign; side: NonNullable<ChangeSide> };
/** One row, or a removed and an added row that replace each other. */
type Entry = { rows: Row[]; showSteps: boolean };
type WeekChanges = { weekStart: string; entries: Entry[]; changes: number; net: string };

/** Weeks shown before the rest folds away, so Apply stays near the summary. */
const OPEN_WEEKS = 2;

function plural(count: number, sport: PlanSport) {
  const item = PLAN_SPORTS.find((entry) => entry.id === sport);
  return count === 1 ? item?.label.toLowerCase() : item?.plural;
}

/** "−2 runs · +1 ride": what the week gains and loses, sport by sport. */
function netText(changes: ChangedSession[]) {
  const net = new Map<PlanSport, number>();
  for (const { before, after } of changes) {
    if (before && !after) net.set(before.sport, (net.get(before.sport) ?? 0) - 1);
    if (after && !before) net.set(after.sport, (net.get(after.sport) ?? 0) + 1);
  }
  return [...net]
    .filter(([, count]) => count !== 0)
    .map(
      ([sport, count]) =>
        `${count > 0 ? "+" : "−"}${Math.abs(count)} ${plural(Math.abs(count), sport)}`,
    )
    .join(" · ");
}

/**
 * The change week by week, as removed and added rows. A session can't change sport, so a run
 * swapped for a ride is a drop and an add: an add right after a drop in the same week reads as
 * its replacement and joins it.
 */
function weeksOf(sessions: ChangedSession[]): WeekChanges[] {
  const byWeek = new Map<string, ChangedSession[]>();
  for (const change of sessions) {
    byWeek.set(change.weekStart, [...(byWeek.get(change.weekStart) ?? []), change]);
  }
  return [...byWeek]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, changes]) => {
      const entries: Entry[] = [];
      for (const { before, after } of changes) {
        const rows: Row[] = [];
        if (before) rows.push({ sign: "removed", side: before });
        if (after) rows.push({ sign: "added", side: after });
        const last = entries.at(-1);
        if (!before && last?.rows.length === 1 && last.rows[0].sign === "removed") {
          last.rows.push(...rows);
        } else {
          entries.push({ rows, showSteps: false });
        }
      }
      // A change of steps under the same title and time shows its steps, or both rows match.
      for (const entry of entries) {
        const [a, b] = entry.rows.map((row) => row.side);
        entry.showSteps = b != null && a.title === b.title && a.minutes === b.minutes;
      }
      return { weekStart, entries, changes: changes.length, net: netText(changes) };
    });
}

function ChangeRow({ sign, side, showSteps }: Row & { showSteps: boolean }) {
  const sport = SPORT_ICON[side.sport];
  const added = sign === "added";
  return (
    <li
      className={cn(
        "flex items-start gap-2.5 px-2.5 py-2 text-sm",
        added ? "bg-success/10" : "bg-destructive/10",
      )}
    >
      <span
        aria-hidden
        className={cn("w-2.5 font-mono font-bold", added ? "text-success" : "text-destructive")}
      >
        {added ? "+" : "−"}
      </span>
      <span className="sr-only">{added ? "Added:" : "Removed:"}</span>
      <sport.icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", sport.className)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{side.title}</span>
        {showSteps
          ? side.steps.map((line, index) => (
              <span key={index} className="text-muted-foreground text-xs">
                {line}
              </span>
            ))
          : null}
      </span>
      <span className="text-muted-foreground mt-0.5 text-xs whitespace-nowrap tabular-nums">
        {/* The coach's titles usually lead with the distance ("4.3 km easy", "2,400 m long swim"). */}
        {side.sport === "ride" || side.title.includes(sessionAmountText(side))
          ? minutesText(side.minutes)
          : `${sessionAmountText(side)} · ${minutesText(side.minutes)}`}
      </span>
    </li>
  );
}

function Week({ week }: { week: WeekChanges }) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={`Week of ${weekLabel(week.weekStart)}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Week of {weekLabel(week.weekStart)}
        </h4>
        {week.net ? (
          <span className="text-muted-foreground text-xs tabular-nums">{week.net}</span>
        ) : null}
      </div>
      {week.entries.map((entry, index) => (
        <ul key={index} className="flex flex-col gap-px overflow-hidden rounded-md">
          {entry.rows.map((row, rowIndex) => (
            <ChangeRow key={rowIndex} {...row} showSteps={entry.showSteps} />
          ))}
        </ul>
      ))}
    </section>
  );
}

const weekLabel = (weekStart: string) => format(parseISO(weekStart), "d MMM");

const countText = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** The weeks of the change, the first ones open and the rest behind one tap. */
function ChangeWeeks({ sessions }: { sessions: ChangedSession[] }) {
  const [showAll, setShowAll] = useState(false);
  const weeks = useMemo(() => weeksOf(sessions), [sessions]);
  const shown = showAll ? weeks : weeks.slice(0, OPEN_WEEKS);
  const folded = weeks.slice(shown.length);
  return (
    <div className="flex flex-col gap-3">
      {shown.map((week) => (
        <Week key={week.weekStart} week={week} />
      ))}
      {folded.length ? (
        <Button variant="outline" className="border-dashed" onClick={() => setShowAll(true)}>
          Show {countText(folded.length, "more week", "more weeks")} ·{" "}
          {countText(
            folded.reduce((sum, week) => sum + week.changes, 0),
            "change",
            "changes",
          )}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      ) : null}
    </div>
  );
}

function Outcome({ call, what = "plan" }: { call: ToolCall; what?: "plan" | "brief" }) {
  const queryClient = useQueryClient();
  // A declined call also gets an output, TanStack AI's { error: "User declined tool execution" },
  // so only an output that says whether it applied is the apply's answer.
  const output = call.output as Partial<PlanChangeApplied> | undefined;
  const applied = output?.applied === true;
  useEffect(() => {
    if (applied) void queryClient.invalidateQueries(coachPlanQueryOptions);
  }, [applied, queryClient]);
  if (applied) {
    return (
      <p className="text-success flex items-center gap-1.5 text-sm font-medium">
        <CheckIcon aria-hidden className="size-4" />
        {what === "brief"
          ? "Saved to your brief: your coming weeks are written again"
          : "Applied to your plan"}
      </p>
    );
  }
  if (output?.applied === false) {
    return <p className="text-destructive text-sm">{output.reason}</p>;
  }
  if (call.approval?.approved === false || output) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <XIcon aria-hidden className="size-4" />
        Declined: your {what} stays as it was
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
 * The change the coach offers with apply_plan_change, as removed and added sessions under their
 * weeks, with Decline and Apply. It shows only a change VO2 checked in this conversation: an id the checker
 * never answered gets no diff.
 */
export function PlanChangeCard({ call }: { call: ToolCall }) {
  const { proposals, approvals, canAnswer } = use(PlanChangeContext);
  const input = call.input as { proposalId?: unknown } | undefined;
  const proposal =
    typeof input?.proposalId === "string" ? proposals.get(input.proposalId) : undefined;
  const approval = approvals.get(call.id);
  const waiting = approval != null && call.state === "approval-requested";
  const changes = proposal?.sessions.length ?? 0;
  const weeks = new Set(proposal?.sessions.map((change) => change.weekStart)).size;
  return (
    <Card size="sm" role="group" aria-label="Plan change" className="sm:max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCogIcon aria-hidden className="size-4" />
          Change to your plan
        </CardTitle>
        <CardDescription className="flex flex-col gap-0.5">
          {weeks > 1 ? (
            <span className="text-xs">
              {weeks} weeks · {countText(changes, "change", "changes")}
            </span>
          ) : null}
          <span>
            {proposal ? proposal.summary : "This change wasn't checked, so it can't be applied."}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {proposal ? <ChangeWeeks sessions={proposal.sessions} /> : null}
        {waiting ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={!canAnswer}
              onClick={() => approval.resolveInterrupt(false)}
            >
              Decline
            </Button>
            {proposal ? (
              <Button
                size="lg"
                className="flex-1"
                disabled={!canAnswer}
                onClick={() => approval.resolveInterrupt(true)}
              >
                <CheckIcon data-icon="inline-start" />
                {changes > 1 ? `Apply ${changes} changes` : "Apply"}
              </Button>
            ) : null}
          </div>
        ) : (
          <Outcome call={call} />
        )}
      </CardContent>
    </Card>
  );
}

function BriefText({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </h4>
      <p
        className={cn(
          "bg-muted/50 rounded-md px-2.5 py-2 text-sm whitespace-pre-line",
          !text && "text-muted-foreground italic",
        )}
      >
        {text || "No brief"}
      </p>
    </div>
  );
}

/**
 * The brief change the coach offers with change_coach_brief (ADR 0065): the brief now and after,
 * with Decline and Apply. Applying rewrites the weeks ahead, so the card says so.
 */
export function BriefChangeCard({ call }: { call: ToolCall }) {
  const { approvals, canAnswer } = use(PlanChangeContext);
  const input = call.input as Partial<BriefChangeInput> | undefined;
  const approval = approvals.get(call.id);
  const waiting = approval != null && call.state === "approval-requested";
  return (
    <Card size="sm" role="group" aria-label="Brief change" className="sm:max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareTextIcon aria-hidden className="size-4" />
          Change to your brief
        </CardTitle>
        {input?.summary ? <CardDescription>{input.summary}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <BriefText label="Now" text={input?.before ?? ""} />
        <BriefText label="After" text={input?.brief ?? ""} />
        {waiting ? (
          <>
            <p className="text-muted-foreground text-xs">Applying rewrites your coming weeks.</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                disabled={!canAnswer}
                onClick={() => approval.resolveInterrupt(false)}
              >
                Decline
              </Button>
              <Button
                size="lg"
                className="flex-1"
                disabled={!canAnswer}
                onClick={() => approval.resolveInterrupt(true)}
              >
                <CheckIcon data-icon="inline-start" />
                Apply
              </Button>
            </div>
          </>
        ) : (
          <Outcome call={call} what="brief" />
        )}
      </CardContent>
    </Card>
  );
}
