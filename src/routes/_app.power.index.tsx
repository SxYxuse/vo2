import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header.tsx";
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
    <PageHeader
      icon={ZapIcon}
      title="Power"
      description="Import a ride's FIT file to see what your power meter recorded."
      actions={action ? <ImportPowerFileButton /> : null}
    />
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
