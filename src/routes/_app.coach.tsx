import { ClientOnly, createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";

import { CoachChat } from "@/components/coach-chat.tsx";
import { Skeleton } from "@/components/ui/skeleton";

type CoachSearch = {
  thread?: string;
  activity?: string;
  power?: string;
  ask?: string;
  change?: true;
};

const MAX_ASK = 500;

export const Route = createFileRoute("/_app/coach")({
  validateSearch: (search: Record<string, unknown>): CoachSearch => ({
    ...(typeof search.thread === "string" && search.thread ? { thread: search.thread } : {}),
    // Strava ids are numeric, so the router parses them as numbers.
    ...(typeof search.activity === "string" || typeof search.activity === "number"
      ? { activity: String(search.activity) }
      : {}),
    ...(typeof search.power === "string" && search.power ? { power: search.power } : {}),
    ...(typeof search.ask === "string" && search.ask ? { ask: search.ask.slice(0, MAX_ASK) } : {}),
    ...(search.change === true ? { change: true as const } : {}),
  }),
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
  const { thread, activity, power, ask, change } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  if (!thread) {
    return (
      <Navigate to="/coach" search={(prev) => ({ ...prev, thread: crypto.randomUUID() })} replace />
    );
  }
  return (
    <ClientOnly fallback={<CoachSkeleton />}>
      <CoachChat
        key={thread}
        threadId={thread}
        initialActivityId={activity}
        initialPowerFileId={power}
        initialQuestion={ask}
        planChange={change}
        onInitialSent={() =>
          void navigate({
            search: ({ activity: _activity, power: _power, ask: _ask, ...rest }) => rest,
            replace: true,
          })
        }
      />
    </ClientOnly>
  );
}
