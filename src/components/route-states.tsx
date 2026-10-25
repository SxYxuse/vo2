"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { RotateCwIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False only when the browser knows it has no network; the server render assumes online. */
export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * A route that failed to load: says why in plain words, and offers a retry that reruns the
 * loaders. An installed app resumed without network lands here, so offline gets its own message.
 */
export function RouteError({
  title,
  error,
  children,
  className,
}: {
  title: string;
  error: unknown;
  /** Extra actions next to Try again, such as a link back. */
  children?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const online = useOnline();
  const [retrying, setRetrying] = useState(false);
  const message = error instanceof Error && error.message ? error.message : null;

  return (
    <Empty className={cn("min-h-64 border", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{online ? <TriangleAlertIcon /> : <WifiOffIcon />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {online
            ? "Something went wrong while loading. Your data is safe; try again."
            : "You're offline. Reconnect, then try again."}
        </EmptyDescription>
        {online && message ? (
          <p className="text-muted-foreground/80 max-w-sm text-xs break-words">{message}</p>
        ) : null}
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void router.invalidate().finally(() => setRetrying(false));
          }}
        >
          {retrying ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RotateCwIcon data-icon="inline-start" />
          )}
          Try again
        </Button>
        {children}
      </EmptyContent>
    </Empty>
  );
}

/** Placeholder for a StatGrid: same panel, same cell padding, so the page doesn't jump. */
export function StatGridSkeleton({ cells, className }: { cells: number; className?: string }) {
  return (
    <div className="ring-foreground/10 overflow-hidden rounded-lg ring-1">
      <div className={cn("-me-px -mb-px grid grid-cols-2", className)}>
        {Array.from({ length: cells }, (_, index) => (
          <div
            key={index}
            className="border-foreground/10 flex flex-col gap-2 border-e border-b p-3"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder for a bordered list of rows, such as the week's days or a calendar agenda. */
export function ListSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={cn("ring-foreground/10 divide-y overflow-hidden rounded-lg ring-1", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 p-3">
          <div className="flex w-10 shrink-0 flex-col items-center gap-1.5">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-5 w-6" />
          </div>
          <Skeleton className="h-9 min-w-0 flex-1 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a titled card holding a chart or a form. */
export function PanelSkeleton({
  className,
  bodyClassName,
}: {
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("ring-foreground/10 flex flex-col gap-3 rounded-lg p-4 ring-1", className)}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full max-w-72" />
      <Skeleton className={cn("h-40 w-full rounded-md", bodyClassName)} />
    </div>
  );
}

/** Placeholder for a row of segmented controls, such as the period picker. */
export function ToolbarSkeleton({ widths = ["w-44"] }: { widths?: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {widths.map((width, index) => (
        <Skeleton key={index} className={cn("h-8 rounded-md", width)} />
      ))}
    </div>
  );
}
