import { useSuspenseQuery } from "@tanstack/react-query";
import { Navigate, createFileRoute, redirect } from "@tanstack/react-router";

import { SignedOutPage } from "@/components/signed-out-page.tsx";
import { appShellQueryOptions, loaderQuery } from "@/lib/app-shell-query.ts";

// Outside the `_app` layout so a signed-out visit downloads none of the app's pages.
export const Route = createFileRoute("/sign-in")({
  loader: async ({ context }) => {
    const shell = await context.queryClient.query(loaderQuery(appShellQueryOptions));
    if (shell.signedIn) {
      throw redirect({ to: "/" });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  const { data } = useSuspenseQuery(appShellQueryOptions);
  if (data.signedIn) {
    return <Navigate to="/" replace />;
  }
  return <SignedOutPage />;
}
