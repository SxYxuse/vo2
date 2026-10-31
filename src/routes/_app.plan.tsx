import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";

import { PlanBuilder } from "@/components/plan-builder.tsx";
import { planningStyleOf } from "@/lib/queries.ts";
import { afterPlanChanged } from "@/lib/query-events.ts";
import { startPlan } from "@/services/plan-builder.ts";

/** Build or rebuild the training plan (ADR 0026). Leaving keeps the plan as it was. */
export const Route = createFileRoute("/_app/plan")({
  loader: async ({ context }) => {
    // The plan builder is the week planner's; This week shows the other styles.
    if ((await planningStyleOf(context)) !== "weekPlanner") {
      throw redirect({ to: "/week", replace: true });
    }
  },
  component: PlanPage,
});

function PlanPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const start = useMutation({
    mutationFn: startPlan,
    onSuccess: async (plan) => {
      await afterPlanChanged(queryClient, plan);
      await navigate({ to: "/week" });
    },
  });
  return (
    <div className="mx-auto w-full max-w-lg">
      <PlanBuilder
        onStart={(draft) => start.mutate({ data: draft })}
        starting={start.isPending}
        error={start.error?.message ?? null}
        onExit={() => {
          if (window.history.length > 1) router.history.back();
          else void navigate({ to: "/week" });
        }}
      />
    </div>
  );
}
