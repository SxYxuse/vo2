import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import { CoachChat } from "@/components/coach-chat.tsx";
import { authClient } from "@/lib/auth-client.ts";
import { Skeleton } from "@/components/ui/skeleton";

type CoachSearch = { activity?: string };

export const Route = createFileRoute("/_app/coach")({
  // `activity` starts the message with that activity mentioned (Ask the coach on its page).
  // Strava ids are numeric, so the router parses them as numbers.
  validateSearch: (search: Record<string, unknown>): CoachSearch =>
    typeof search.activity === "string" || typeof search.activity === "number"
      ? { activity: String(search.activity) }
      : {},
  component: CoachPage,
});

function CoachSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Skeleton className="h-8 w-32" />
      <div className="flex-1" />
      <Skeleton className="mx-auto h-20 w-full max-w-3xl rounded-lg" />
    </div>
  );
}

function CoachPage() {
  const { activity } = Route.useSearch();
  const { data: session } = authClient.useSession();
  // The chat lives in this browser's storage, so it renders on the client only.
  return (
    <ClientOnly fallback={<CoachSkeleton />}>
      {session ? (
        <CoachChat userId={session.user.id} initialActivityId={activity} />
      ) : (
        <CoachSkeleton />
      )}
    </ClientOnly>
  );
}
