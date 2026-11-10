import type { ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { FlagIcon } from "lucide-react";

import { SeasonView } from "@/components/season.tsx";
import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { loaderQuery, seasonQueryOptions } from "@/lib/queries.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RouteError } from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/season")({
  loader: ({ context }) => context.queryClient.query(loaderQuery(seasonQueryOptions)),
  pendingMs: 200,
  pendingComponent: SeasonPending,
  errorComponent: SeasonError,
  component: SeasonPage,
});

function SeasonHeader({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      icon={FlagIcon}
      title="Season"
      description={"The races and events you train for."}
      actions={actions}
    />
  );
}

function SeasonPage() {
  const { data } = useSuspenseQuery(seasonQueryOptions);

  if (!data.signedIn) {
    return (
      <>
        <SeasonHeader />
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>Sign in to plan your season</EmptyTitle>
            <EmptyDescription>
              Connect Strava so the plan builds toward your goals from your own activities.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <SignInPanel />
      </>
    );
  }

  return (
    <>
      <SeasonView data={data} header={(actions) => <SeasonHeader actions={actions} />} />
    </>
  );
}

function SeasonPending() {
  return (
    <>
      <SeasonHeader />
      <PanelSkeleton bodyClassName="h-32" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </>
  );
}

function SeasonError({ error }: ErrorComponentProps) {
  return (
    <>
      <SeasonHeader />
      <RouteError title="Could not load your season" error={error} />
    </>
  );
}
