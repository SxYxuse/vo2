import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Navigate,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { ProfilePrompt, OnboardingForm } from "@/components/onboarding.tsx";
import { OnboardingShell } from "@/components/onboarding-shell.tsx";
import { authClient } from "@/lib/auth-client.ts";
import { appShellQueryOptions, loaderQuery, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { isSetUp } from "@/services/app-setup.ts";
import { isTrainingPlanComplete } from "@/services/training-plan.ts";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteError } from "@/components/route-states.tsx";

export const Route = createFileRoute("/onboarding")({
  loader: async ({ context }) => {
    const shell = await context.queryClient.query(loaderQuery(appShellQueryOptions));
    if (!shell.signedIn) {
      throw redirect({ to: "/sign-in" });
    }
    if (isSetUp(shell)) {
      throw redirect({ to: "/" });
    }
    return context.queryClient.query(loaderQuery(settingsSnapshotQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: OnboardingPending,
  errorComponent: OnboardingError,
  component: OnboardingPage,
});

function OnboardingPage() {
  useSuspenseQuery(settingsSnapshotQueryOptions);
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  const { data: session } = authClient.useSession();

  if (!shell.signedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <OnboardingShell>
      {isTrainingPlanComplete(shell.training) && !shell.hasProfile ? (
        <ProfilePrompt />
      ) : (
        <OnboardingForm userName={session?.user.name ?? ""} />
      )}
    </OnboardingShell>
  );
}

function OnboardingPending() {
  return (
    <OnboardingShell>
      <Skeleton className="h-96 w-full rounded-xl" />
    </OnboardingShell>
  );
}

function OnboardingError({ error }: ErrorComponentProps) {
  return (
    <OnboardingShell>
      <RouteError title="Could not load setup" error={error} />
    </OnboardingShell>
  );
}
