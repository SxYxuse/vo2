import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Navigate,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { BirthDatePrompt, OnboardingForm, OnboardingShell } from "@/components/onboarding.tsx";
import { authClient } from "@/lib/auth-client.ts";
import { appShellQueryOptions, loaderQuery, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { isSetUp } from "@/services/app-shell.ts";
import { isTrainingPlanComplete } from "@/services/training-plan.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/onboarding")({
  loader: async ({ context }) => {
    const shell = await context.queryClient.query(loaderQuery(appShellQueryOptions));
    if (!shell.signedIn) {
      throw redirect({ to: "/" });
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
    return <Navigate to="/" replace />;
  }

  return (
    <OnboardingShell>
      {isTrainingPlanComplete(shell.training) && !shell.hasBirthDate ? (
        <BirthDatePrompt />
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
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <OnboardingShell>
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Could not load setup</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </OnboardingShell>
  );
}
