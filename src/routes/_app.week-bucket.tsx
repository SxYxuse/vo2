import { createFileRoute, redirect } from "@tanstack/react-router";

/** The week bucket became the week target; keep old links and installed shortcuts working. */
export const Route = createFileRoute("/_app/week-bucket")({
  beforeLoad: () => {
    throw redirect({ to: "/week", replace: true });
  },
});
