import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/plan")({
  beforeLoad: () => {
    throw redirect({ to: "/week", replace: true });
  },
});
