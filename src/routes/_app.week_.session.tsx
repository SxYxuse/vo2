import { useMemo } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, type ErrorComponentProps } from "@tanstack/react-router";

import { SessionDetail } from "@/components/session-detail.tsx";
import {
  isPlanningOff,
  loaderQuery,
  weekCoachQueryOptions,
  weekTargetQueryOptions,
} from "@/lib/queries.ts";
import { matchWeek, sessionRecommendation } from "@/services/week-plan.ts";
import { summarizeWeek } from "@/services/week-target.ts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RouteError } from "@/components/route-states.tsx";

type SessionSearch = {
  /** The day of this week the session is planned on. */
  date?: string;
  /** The planned session's id within the week plan. */
  id?: string;
};

export const Route = createFileRoute("/_app/week_/session")({
  validateSearch: (search: Record<string, unknown>): SessionSearch => ({
    ...(typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
      ? { date: search.date }
      : {}),
    ...(typeof search.id === "string" && search.id ? { id: search.id } : {}),
  }),
  loader: async ({ context }) => {
    // This week says planning is off and leads back to it.
    if (await isPlanningOff(context)) throw redirect({ to: "/week", replace: true });
    void context.queryClient.prefetchQuery(weekCoachQueryOptions);
    await context.queryClient.query(loaderQuery(weekTargetQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: SessionPage,
});

function SessionPage() {
  const { data } = useSuspenseQuery(weekTargetQueryOptions);
  const { data: coach } = useQuery(weekCoachQueryOptions);
  const { date, id } = Route.useSearch();
  const plan = data.plan;
  const view = useMemo(() => {
    if (!plan || !coach?.plan) return null;
    const planned = { ...data, plan };
    const summary = summarizeWeek(planned);
    const dayView = matchWeek(coach.plan, data, summary).find((item) => item.day.date === date);
    const item = dayView?.sessions.find((entry) => entry.session.id === id);
    if (!dayView || !item) return null;
    const pick = sessionRecommendation(planned, summary, dayView.day, item.session);
    return pick ? { pick, summary, planned, item, dayView } : null;
  }, [data, plan, coach?.plan, date, id]);

  if (!coach) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!view) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Session not found</EmptyTitle>
          <EmptyDescription>
            This session is no longer in your week plan. Pick one from This week.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/week" />} nativeButton={false}>
            This week
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <SessionDetail
      pick={view.pick}
      data={view.planned}
      summary={view.summary}
      date={view.dayView.day.date}
      today={data.today}
      state={view.item.state}
      activityTitle={view.item.activity?.title ?? null}
    />
  );
}

function SessionPending() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <PanelSkeleton bodyClassName="h-48" />
      <PanelSkeleton bodyClassName="h-32" />
    </div>
  );
}

function SessionError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load the session" error={error} />;
}
