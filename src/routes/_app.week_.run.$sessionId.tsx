import { createFileRoute, redirect, type ErrorComponentProps } from "@tanstack/react-router";

import { CoachSession } from "@/components/coach-session.tsx";
import { PanelSkeleton, RouteError } from "@/components/route-states.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { coachPlanQueryOptions, loaderQuery, planningStyleOf } from "@/lib/queries.ts";

export const Route = createFileRoute("/_app/week_/run/$sessionId")({
  loader: async ({ context }) => {
    // A coach-plan run; the week planner has its own session page.
    if ((await planningStyleOf(context)) !== "coachPlan") {
      throw redirect({ to: "/week", replace: true });
    }
    await context.queryClient.query(loaderQuery(coachPlanQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: RunPending,
  errorComponent: RunError,
  component: RunPage,
});

function RunPage() {
  const { sessionId } = Route.useParams();
  return <CoachSession sessionId={sessionId} />;
}

function RunPending() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <PanelSkeleton bodyClassName="h-48" />
    </div>
  );
}

function RunError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load the session" error={error} />;
}
