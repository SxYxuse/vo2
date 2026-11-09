import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { WaypointsIcon } from "lucide-react";

import { RouteBuilder } from "@/components/route-builder.tsx";
import { RouteError } from "@/components/route-states.tsx";
import { SignInPanel } from "@/components/sign-in-panel.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { loaderQuery, routeBuilderStatusQueryOptions } from "@/lib/queries.ts";

export const Route = createFileRoute("/_app/route-builder")({
  // The zone and the routes live on the device (ADR 0062), so there is nothing to render on the server.
  ssr: false,
  loader: ({ context }) => {
    // Fetch MapLibre alongside the status, on preload too, but never at app start.
    void import("@/components/route-builder-map-view.tsx");
    return context.queryClient.query(loaderQuery(routeBuilderStatusQueryOptions));
  },
  pendingMs: 200,
  pendingComponent: RouteBuilderPending,
  errorComponent: RouteBuilderError,
  component: RouteBuilderPage,
});

function Heading() {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        <WaypointsIcon aria-hidden className="size-5" />
        Route builder
      </h1>
      <p className="text-muted-foreground hidden text-sm sm:block">
        Road and gravel loops inside a zone, checked against OpenStreetMap and popular Strava
        segments.
      </p>
    </div>
  );
}

function RouteBuilderPage() {
  const { data } = useSuspenseQuery(routeBuilderStatusQueryOptions);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Heading />
      {data.signedIn ? (
        <RouteBuilder status={data} />
      ) : (
        <>
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WaypointsIcon />
              </EmptyMedia>
              <EmptyTitle>Sign in to build routes</EmptyTitle>
              <EmptyDescription>
                Connect Strava so VO2 can start loops from where you ride and weigh popular
                segments.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <SignInPanel />
        </>
      )}
    </div>
  );
}

function RouteBuilderPending() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Heading />
      <Skeleton className="min-h-80 w-full flex-1 rounded-xl" />
    </div>
  );
}

function RouteBuilderError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load the route builder" error={error} />;
}
