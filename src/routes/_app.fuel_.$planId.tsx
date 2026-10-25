import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

import { RoutePlanDetail } from "@/components/route-plan-detail.tsx";
import { loaderQuery, routePlanQueryOptions } from "@/lib/queries.ts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RouteError, StatGridSkeleton } from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/fuel_/$planId")({
  loader: ({ context, params }) =>
    context.queryClient.query(loaderQuery(routePlanQueryOptions(params.planId))),
  pendingMs: 200,
  pendingComponent: RoutePlanPending,
  errorComponent: RoutePlanError,
  component: RoutePlanPage,
});

function BackToRoutes() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ms-2 self-start"
      nativeButton={false}
      render={<Link to="/fuel" />}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      Routes
    </Button>
  );
}

function RoutePlanPage() {
  const { planId } = Route.useParams();
  const { data: plan } = useSuspenseQuery(routePlanQueryOptions(planId));

  if (!plan) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Route not found</EmptyTitle>
          <EmptyDescription>It may have been deleted.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <BackToRoutes />
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <>
      <BackToRoutes />
      <RoutePlanDetail plan={plan} />
    </>
  );
}

function RoutePlanPending() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <StatGridSkeleton cells={4} className="lg:grid-cols-4" />
      <Skeleton className="h-52 w-full rounded-lg" />
      <PanelSkeleton />
    </div>
  );
}

function RoutePlanError({ error }: ErrorComponentProps) {
  return (
    <RouteError title="Could not load this route" error={error}>
      <BackToRoutes />
    </RouteError>
  );
}
