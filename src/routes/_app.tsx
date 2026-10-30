import { useEffect } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Navigate,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar.tsx";
import { OfflineBanner } from "@/components/offline-banner.tsx";
import { SyncPanel } from "@/components/sync-panel.tsx";
import { TopEffortCelebration } from "@/components/top-effort-celebration.tsx";
import { useSyncAutoResume } from "@/hooks/use-sync-auto-resume.ts";
import { scheduleIdle, warmApp } from "@/lib/prefetch.ts";
import { appShellQueryOptions, loaderQuery } from "@/lib/queries.ts";
import { isSetUp } from "@/services/app-shell.ts";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_app")({
  loader: async ({ context }) => {
    // Offline, the views saved on this device are all there is to show.
    await context.offlineCopyRestored;
    const shell = await context.queryClient.query(loaderQuery(appShellQueryOptions));
    if (!shell.signedIn) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isSetUp(shell)) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: AppLayout,
});

function SignedInPrefetch() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    return scheduleIdle(() => warmApp(router, queryClient));
  }, [queryClient, router]);
  return null;
}

function SyncAutoResume() {
  useSyncAutoResume();
  return null;
}

function AppLayout() {
  const { data, dataUpdatedAt } = useSuspenseQuery(appShellQueryOptions);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (!data.signedIn) {
    return <Navigate to="/sign-in" replace />;
  }
  if (!isSetUp(data)) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <SidebarProvider>
      <SignedInPrefetch />
      <SyncAutoResume />
      <TopEffortCelebration />
      <AppSidebar />
      {/* The coach chat scrolls inside itself, so its page is exactly one screen tall; other
          pages grow and scroll the document. */}
      <SidebarInset className={pathname === "/coach" ? "h-dvh overflow-hidden" : undefined}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 pt-[max(0px,env(safe-area-inset-top))] md:pt-0">
          <SidebarTrigger />
          <SyncPanel />
        </header>
        <OfflineBanner updatedAt={dataUpdatedAt} />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-6 sm:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
