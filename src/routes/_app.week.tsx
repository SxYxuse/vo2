import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { Settings2Icon, TargetIcon } from "lucide-react";

import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { CoachPlanView } from "@/components/coach-plan-view.tsx";
import { PanelSkeleton } from "@/components/route-states.tsx";
import {
  appShellQueryOptions,
  coachPlanQueryOptions,
  planningStyleOf,
  loaderQuery,
} from "@/lib/queries.ts";
import { Button } from "@/components/ui/button";
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
    await context.queryClient.query(loaderQuery(coachPlanQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: WeekTargetPending,
  errorComponent: WeekTargetError,
  component: WeekTargetPage,
});

function WeekTargetHeading({ planned = true }: { planned?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        <TargetIcon aria-hidden className="size-5" />
        Plan
      </h1>
      <p className="text-muted-foreground hidden text-sm sm:block">
        {planned
          ? "Your coach plan: each week's runs, rides, and swims for the next four weeks, toward your season. Do them on the days that suit you."
          : "No week is planned while planning is off."}
      </p>
    </div>
  );
}

function WeekTargetPage() {
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  const { week } = Route.useSearch();
  if (!shell.signedIn) return <SignedOut />;
  if (shell.planningStyle !== "coachPlan") return <PlanningOff />;
  return (
    <>
      <WeekTargetHeading />
      <CoachPlanView week={week} />
    </>
  );
}

/** The way back from off: the coach plan's setup is still saved, one choice away. */
function PlanningOff() {
  return (
    <>
      <WeekTargetHeading planned={false} />
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
