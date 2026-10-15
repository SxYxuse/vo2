import { lazy, Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { FlaskConicalIcon } from "lucide-react";

const AssessmentTests = lazy(() =>
  import("#/components/assessment-tests.tsx").then((mod) => ({ default: mod.AssessmentTests })),
);
import { SignInPanel } from "#/components/sync-panel.tsx";
import { assessmentsQueryOptions } from "#/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/tests")({
  loader: ({ context }) => context.queryClient.ensureQueryData(assessmentsQueryOptions),
  pendingMs: 200,
  pendingComponent: TestsPending,
  errorComponent: TestsError,
  component: TestsPage,
});

function TestsPage() {
  const { data } = useSuspenseQuery(assessmentsQueryOptions);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <FlaskConicalIcon aria-hidden className="size-5" />
          Field tests
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Published field tests for FTP, VO2max, and lactate-threshold heart rate. Suggested when
          form allows — never mixed into the weekly workout bucket. After you do one, open the
          Strava activity and flag it as that test so the result is stored. Turn protocols on or off
          in Settings.
        </p>
      </div>
      {data.signedIn ? (
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <AssessmentTests tests={data.tests} />
        </Suspense>
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConicalIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to see suggested tests</EmptyTitle>
              <EmptyDescription>
                Connect Strava so we can skip tests you already logged and wait when form is low.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      )}
    </>
  );
}

function TestsPending() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <FlaskConicalIcon aria-hidden className="size-5" />
          Field tests
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Published field tests for FTP, VO2max, and lactate-threshold heart rate. Suggested when
          form allows — never mixed into the weekly workout bucket. After you do one, open the
          Strava activity and flag it as that test so the result is stored. Turn protocols on or off
          in Settings.
        </p>
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </>
  );
}

function TestsError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load tests</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
