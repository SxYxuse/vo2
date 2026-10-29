import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";

import { CoachChat } from "@/components/coach-chat.tsx";
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
  const navigate = useNavigate({ from: Route.fullPath });
  // The chat lives in this browser's storage, so it renders on the client only. It needs no
  // session, so it still opens offline.
  return (
    <ClientOnly fallback={<CoachSkeleton />}>
      <CoachChat
        initialActivityId={activity}
        // Once sent, the mention is in the chat; a reload must not offer it again.
        onInitialActivitySent={() => void navigate({ search: {}, replace: true })}
      />
    </ClientOnly>
  );
}
