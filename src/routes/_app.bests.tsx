import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { TrophyIcon } from "lucide-react";

import { BestsView } from "@/components/personal-bests.tsx";
import { SignInPanel } from "@/components/sync-panel.tsx";
import { bestsQueryOptions, loaderQuery } from "@/lib/queries.ts";
import { parseBestsSearch, type BestsSearch } from "@/services/personal-bests.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/bests")({
  validateSearch: (search: Record<string, unknown>): BestsSearch => parseBestsSearch(search),
  loader: ({ context }) => context.queryClient.query(loaderQuery(bestsQueryOptions)),
  pendingMs: 200,
  pendingComponent: BestsPending,
  errorComponent: BestsError,
  component: BestsPage,
});

function BestsHeading() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        <TrophyIcon aria-hidden className="size-5" />
        Bests
      </h1>
      <p className="text-muted-foreground hidden text-sm sm:block">
        Your personal bests on every distance and duration, how they progressed, and your top ten.
      </p>
    </div>
  );
}

function BestsPage() {
  const { data } = useSuspenseQuery(bestsQueryOptions);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      <BestsHeading />
      {data.signedIn ? (
        <BestsView
          data={data}
          search={search}
          // Opening a board pushes history, so a back gesture closes the sheet.
          onSearchChange={(next, options) =>
            void navigate({ search: next, replace: options?.replace ?? false, resetScroll: false })
          }
        />
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TrophyIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to see your bests</EmptyTitle>
              <EmptyDescription>
                Connect Strava to find your fastest times, best power, and biggest days.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      )}
    </>
  );
}

function BestsPending() {
  return (
    <>
      <BestsHeading />
      <Skeleton className="h-9 w-full rounded-lg sm:w-72" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
    </>
  );
}

function BestsError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyTitle>Could not load bests</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
