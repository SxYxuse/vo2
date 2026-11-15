import { useState, type ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { Settings2Icon, TargetIcon, ThermometerIcon } from "lucide-react";

import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { CoachPlanView } from "@/components/coach-plan-view.tsx";
import { PanelSkeleton } from "@/components/route-states.tsx";
import {
  TimeOutBanner,
  TimeOutSheet,
  currentTimeOut,
  type TimeOutEditing,
} from "@/components/time-out-sheet.tsx";
import {
  appShellQueryOptions,
  coachPlanQueryOptions,
  planningStyleOf,
  loaderQuery,
  timeOutsQueryOptions,
} from "@/lib/queries.ts";
import { Button } from "@/components/ui/button";
import { dayKey } from "@/services/day-key.ts";
import { timeOutOpen } from "@/services/time-outs.ts";
import { Link } from "@tanstack/react-router";
import { EmptyContent } from "@/components/ui/empty";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { RouteError } from "@/components/route-states.tsx";

type WeekSearch = {
  /** The coach plan's week shown, by its Monday, when not the first one. */
  week?: string;
};

export const Route = createFileRoute("/_app/week")({
  validateSearch: (search: Record<string, unknown>): WeekSearch =>
    typeof search.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.week)
      ? { week: search.week }
      : {},
  loader: async ({ context }) => {
    if ((await planningStyleOf(context)) !== "coachPlan") return;
    await Promise.all([
      context.queryClient.query(loaderQuery(coachPlanQueryOptions)),
      context.queryClient.query(loaderQuery(timeOutsQueryOptions)),
    ]);
  },
  pendingMs: 200,
  pendingComponent: WeekTargetPending,
  errorComponent: WeekTargetError,
  component: WeekTargetPage,
});

function WeekTargetHeading({ actions }: { actions?: ReactNode }) {
  return <PageHeader icon={TargetIcon} title="Plan" actions={actions} />;
}

function WeekTargetPage() {
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  const { week } = Route.useSearch();
  if (!shell.signedIn) return <SignedOut />;
  if (shell.planningStyle !== "coachPlan") return <PlanningOff />;
  return <CoachPlanPage week={week} />;
}

/** The coach plan, with the time out the athlete is on or has ahead (ADR 0066). */
function CoachPlanPage({ week }: { week?: string }) {
  const { timeOuts } = useSuspenseQuery(timeOutsQueryOptions).data;
  const [editing, setEditing] = useState<TimeOutEditing>(null);
  const today = dayKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const timeOut = currentTimeOut(timeOuts, today);
  return (
    <>
      <WeekTargetHeading
        actions={
          // The banner is the way in while one lasts or is ahead.
          timeOut ? undefined : (
            <Button
              type="button"
              variant="outline"
              className="min-h-[2.75rem]"
              onClick={() => setEditing("new")}
            >
              <ThermometerIcon data-icon="inline-start" />
              Sick or injured
            </Button>
          )
        }
      />
      {timeOut ? <TimeOutBanner timeOut={timeOut} today={today} onEdit={setEditing} /> : null}
      <CoachPlanView week={week} paused={timeOut != null && timeOutOpen(timeOut, today)} />
      <TimeOutSheet editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** The way back from off: the coach plan's setup is still saved, one choice away. */
function PlanningOff() {
  return (
    <>
      <WeekTargetHeading />
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TargetIcon />
          </EmptyMedia>
          <EmptyTitle>Planning is off</EmptyTitle>
          <EmptyDescription>
            VO2 plans nothing for now. Season, the calendar, fitness, and the coach chat stay. Pick
            a planning style in Settings to plan your weeks again.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            nativeButton={false}
            render={<Link to="/settings/$section" params={{ section: "training" }} />}
          >
            <Settings2Icon data-icon="inline-start" />
            Choose a planning style
          </Button>
        </EmptyContent>
      </Empty>
    </>
  );
}

function SignedOut() {
  return (
    <>
      <WeekTargetHeading />
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TargetIcon />
          </EmptyMedia>
          <EmptyTitle>Sign in to see your plan</EmptyTitle>
          <EmptyDescription>
            Connect Strava so your plan starts from what you already do.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <SignInPanel />
    </>
  );
}

function WeekTargetPending() {
  return (
    <>
      <WeekTargetHeading />
      <PanelSkeleton bodyClassName="h-64" />
    </>
  );
}

function WeekTargetError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load this week" error={error} />;
}
