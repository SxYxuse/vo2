import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import { ZapIcon } from "lucide-react";

import { ImportPowerFileButton, PowerFilesView } from "@/components/power-files.tsx";
import { RouteError } from "@/components/route-states.tsx";
import { loaderQuery, powerFilesQueryOptions } from "@/lib/queries.ts";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/power/")({
  loader: ({ context }) => context.queryClient.query(loaderQuery(powerFilesQueryOptions)),
  pendingMs: 200,
  pendingComponent: PowerPending,
  errorComponent: PowerError,
  component: PowerPage,
});

function PowerHeading({ action }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <ZapIcon aria-hidden className="size-5" />
          Power
        </h1>
        {action ? <ImportPowerFileButton /> : null}
      </div>
      <p className="text-muted-foreground hidden text-sm sm:block">
        Import a ride&apos;s FIT file to see what your power meter recorded: each leg&apos;s share,
        where you push on the pedal, each stroke, and your gears.
      </p>
    </div>
  );
}

function PowerPage() {
  const { data } = useSuspenseQuery(powerFilesQueryOptions);
  return (
    <>
      <PowerHeading action={data.length > 0} />
      <PowerFilesView files={data} />
    </>
  );
}

function PowerPending() {
  return (
    <>
      <PowerHeading />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-md" />
      ))}
    </>
  );
}

function PowerError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load your power files" error={error} />;
}
