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
  // `thread` is the chat open; without one, a new chat starts.
  // `activity` starts the message with that activity mentioned (Ask the coach on its page).
  // Strava ids are numeric, so the router parses them as numbers.
  // `power` brings in a power file, and `ask` starts the message with a question (Ask the coach on
  // a power file and its sections).
  // `change` comes from "Ask the coach to change my plan" on the coach plan.
  validateSearch: (search: Record<string, unknown>): CoachSearch => ({
    ...(typeof search.thread === "string" && search.thread ? { thread: search.thread } : {}),
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
  // The chat's id is in the address from the start, so a reload or a return keeps it.
  if (!thread) {
    return (
      <Navigate to="/coach" search={(prev) => ({ ...prev, thread: crypto.randomUUID() })} replace />
    );
  }
  // The chat renders on the client only: it loads from the server, or from the copy saved for
  // offline, through TanStack AI.
  return (
    <ClientOnly fallback={<CoachSkeleton />}>
      <CoachChat
        key={thread}
        threadId={thread}
        initialActivityId={activity}
        initialPowerFileId={power}
        initialQuestion={ask}
        planChange={change}
        // Once sent, the mention is in the chat; a reload must not offer it again.
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
