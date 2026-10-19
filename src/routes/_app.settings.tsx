import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useParams, type ErrorComponentProps } from "@tanstack/react-router";

import { Settings2Icon } from "lucide-react";

import { SettingsForm } from "@/components/settings.tsx";
import { authClient } from "@/lib/auth-client.ts";
import { loaderQuery, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { isSettingsSection } from "@/lib/settings-sections.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

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
  if (!section || !isSettingsSection(section)) return null;

  return <SettingsForm section={section} userName={session?.user.name ?? ""} />;
}

function SettingsPending() {
  return (
    <>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </>
  );
}

function SettingsError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Settings2Icon />
        </EmptyMedia>
        <EmptyTitle>Could not load settings</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
