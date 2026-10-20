import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { SessionDetail } from "@/components/session-detail.tsx";
import { loaderQuery, weekTargetQueryOptions } from "@/lib/queries.ts";
import {
  AVAILABLE_WINDOWS,
  TODAY_FEELS,
  TODAY_SPORTS,
  keySessionRecommendation,
  recommendToday,
  summarizeWeek,
  type TodayFeel,
  type TodaySport,
} from "@/services/week-target.ts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

type SessionSearch = {
  /** Today's choice: shows today's pick for that window, sport, and feel. */
  available?: number;
  sport?: TodaySport;
  feel?: TodayFeel;
  /** A key session id from the week mix. */
  key?: string;
};

export const Route = createFileRoute("/_app/week_/session")({
  validateSearch: (search: Record<string, unknown>): SessionSearch => {
    const available = Number(search.available);
    const key = typeof search.key === "string" && search.key ? search.key : undefined;
    if (key) return { key };
    const sport = TODAY_SPORTS.find((item) => item.id === search.sport)?.id;
    const feel = TODAY_FEELS.find((item) => item.id === search.feel)?.id;
    return {
      ...(AVAILABLE_WINDOWS.some((window) => window.minutes === available) ? { available } : {}),
      ...(sport ? { sport } : {}),
      ...(feel ? { feel } : {}),
    };
  },
  loader: ({ context }) => context.queryClient.query(loaderQuery(weekTargetQueryOptions)),
  pendingMs: 200,
  pendingComponent: () => <Skeleton className="h-96 w-full rounded-xl" />,
  errorComponent: SessionError,
  component: SessionPage,
});

function SessionPage() {
  const { data } = useSuspenseQuery(weekTargetQueryOptions);
  const { available, sport, feel, key } = Route.useSearch();
  const plan = data.plan;
  const view = useMemo(() => {
    if (!plan) return null;
    const planned = { ...data, plan };
    const summary = summarizeWeek(planned);
    const pick = key
      ? keySessionRecommendation(planned, summary, key)
      : recommendToday(planned, summary, {
          available: available ?? 60,
          sport: sport ?? "any",
          feel: feel ?? "auto",
        });
    return pick ? { pick, summary, planned } : null;
  }, [data, plan, available, sport, feel, key]);

  if (!view) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Session not found</EmptyTitle>
          <EmptyDescription>
            This key session is no longer in your week mix. Pick one from the Week target page.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/week" />} nativeButton={false}>
            Week target
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
      source={key ? "week-mix" : "today"}
    />
  );
}

function SessionError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load the session</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
