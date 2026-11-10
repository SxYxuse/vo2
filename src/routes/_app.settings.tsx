import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  useParams,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { SettingsForm } from "@/components/settings.tsx";
import { authClient } from "@/lib/auth-client.ts";
import { loaderQuery, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { isSettingsSection } from "@/lib/settings-sections.ts";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RouteError } from "@/components/route-states.tsx";

export const Route = createFileRoute("/_app/settings")({
  loader: ({ context }) => context.queryClient.query(loaderQuery(settingsSnapshotQueryOptions)),
  pendingMs: 200,
  pendingComponent: SettingsPending,
  errorComponent: SettingsError,
  component: SettingsPage,
});

function SettingsPage() {
  useSuspenseQuery(settingsSnapshotQueryOptions);
  const { data: session } = authClient.useSession();
  const { section } = useParams({ strict: false });
  if (!section || !isSettingsSection(section)) return <Outlet />;

  return <SettingsForm section={section} userName={session?.user.name ?? ""} />;
}

function SettingsPending() {
  return (
    <>
      <Skeleton className="h-8 w-40" />
      <PanelSkeleton bodyClassName="h-64" />
    </>
  );
}

function SettingsError({ error }: ErrorComponentProps) {
  return <RouteError title="Could not load settings" error={error} />;
}
