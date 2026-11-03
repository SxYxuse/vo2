import { createFileRoute, redirect } from "@tanstack/react-router";

/** The week planner's plan builder is gone (ADR 0050); keep old links and shortcuts working. */
export const Route = createFileRoute("/_app/plan")({
  beforeLoad: () => {
    throw redirect({ to: "/week", replace: true });
  },
});
