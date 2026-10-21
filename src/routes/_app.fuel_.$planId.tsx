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

export const Route = createFileRoute("/_app/fuel_/$planId")({
  loader: ({ context, params }) =>
    context.queryClient.query(loaderQuery(routePlanQueryOptions(params.planId))),
  pendingMs: 200,
  pendingComponent: () => <Skeleton className="h-96 w-full rounded-xl" />,
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

function RoutePlanError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load this route</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <BackToRoutes />
      </EmptyContent>
    </Empty>
  );
}
