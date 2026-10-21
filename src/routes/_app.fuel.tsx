import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { ChevronRightIcon, RouteIcon } from "lucide-react";

import { FuelProductsPicker } from "@/components/fuel-products-picker.tsx";
import { RouteUploadForm } from "@/components/route-upload-form.tsx";
import { SignInPanel } from "@/components/sync-panel.tsx";
import { loaderQuery, routePlansQueryOptions } from "@/lib/queries.ts";
import { formatDistanceKm, formatElevation } from "@/services/activity-detail.types.ts";
import { formatSportType } from "@/services/athlete-settings.types.ts";
import { formatAroundTime } from "@/services/fuel-plan.ts";
import type { RoutePlanSummary } from "@/services/route-plan.ts";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/fuel")({
  loader: ({ context }) => context.queryClient.query(loaderQuery(routePlansQueryOptions)),
  pendingMs: 200,
  pendingComponent: FuelPending,
  errorComponent: FuelError,
  component: FuelPage,
});

function FuelHeader() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        <RouteIcon aria-hidden className="size-5" />
        Fuel
      </h1>
      <p className="text-muted-foreground hidden text-sm sm:block">
        Choose the products you have, then upload a GPX to see the route and plan what to eat and
        drink on it.
      </p>
    </div>
  );
}

function FuelPage() {
  const { data } = useSuspenseQuery(routePlansQueryOptions);

  if (!data.signedIn) {
    return (
      <>
        <FuelHeader />
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RouteIcon />
            </EmptyMedia>
            <EmptyTitle>Sign in to plan fuel</EmptyTitle>
            <EmptyDescription>
              Connect Strava so routes are predicted from your own activities.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <SignInPanel />
      </>
    );
  }

  return (
    <>
      <FuelHeader />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <FuelProductsPicker productIds={data.fuelProductIds} />
          {data.canPlan ? (
            <RouteUploadForm defaults={data.defaults} defaultSportType={data.defaultSportType} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Choose a drink mix, a jelly or bar, and a gel above, then upload a GPX.
            </p>
          )}
        </div>
        <section className="flex flex-col gap-2" aria-label="Your routes">
          <h2 className="text-sm font-medium">Your routes</h2>
          {data.plans.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {data.canPlan
                ? "No routes yet. Upload a GPX to get a prediction and fuel plans."
                : "No routes yet. Choose your products first, then upload a GPX."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {data.plans.map((plan) => (
                <RouteRow key={plan.id} plan={plan} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function RouteRow({ plan }: { plan: RoutePlanSummary }) {
  return (
    <li>
      <Link
        to="/fuel/$planId"
        params={{ planId: plan.id }}
        preload="intent"
        className="hover:bg-muted/50 flex min-h-14 items-center gap-3 px-3 py-2.5"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{plan.name}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatSportType(plan.sportType)} · {formatDistanceKm(plan.distanceM)} ·{" "}
            {formatElevation(plan.gainM)} · about {formatAroundTime(plan.elapsedSec)}
          </span>
        </div>
        {plan.chosenName ? <Badge variant="secondary">{plan.chosenName}</Badge> : null}
        <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      </Link>
    </li>
  );
}

function FuelPending() {
  return (
    <>
      <FuelHeader />
      <Skeleton className="h-96 w-full rounded-xl" />
    </>
  );
}

function FuelError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <>
      <FuelHeader />
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>Could not load your routes</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}
