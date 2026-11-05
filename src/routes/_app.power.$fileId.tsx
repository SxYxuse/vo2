import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";

import {
  PowerFileDetailMissing,
  PowerFileDetailPending,
  PowerFileDetailView,
} from "@/components/power-file-detail.tsx";
import { RouteError } from "@/components/route-states.tsx";
import { loaderQuery, powerFileQueryOptions } from "@/lib/queries.ts";

export const Route = createFileRoute("/_app/power/$fileId")({
  loader: ({ context, params }) =>
    context.queryClient.query(loaderQuery(powerFileQueryOptions(params.fileId))),
  pendingMs: 200,
  pendingComponent: PowerFileDetailPending,
  errorComponent: PowerFileError,
  component: PowerFilePage,
});

function PowerFilePage() {
  const { fileId } = Route.useParams();
  const { data } = useSuspenseQuery(powerFileQueryOptions(fileId));
  return data ? <PowerFileDetailView key={data.id} file={data} /> : <PowerFileDetailMissing />;
}

function PowerFileError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load this power file" error={error} />;
}
