import { useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SignedOutPage } from "#/components/signed-out-page.tsx";
import { SyncPanel } from "#/components/sync-panel.tsx";
import { appShellQueryOptions } from "#/lib/queries.ts";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const shell = await context.queryClient.ensureQueryData(appShellQueryOptions);
    if (!shell.signedIn && location.pathname !== "/") {
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(appShellQueryOptions),
  component: AppLayout,
});

function AppLayout() {
  const { data } = useSuspenseQuery(appShellQueryOptions);
  if (!data.signedIn) {
    return <SignedOutPage />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 pt-[max(0px,env(safe-area-inset-top))] md:pt-0">
          <SidebarTrigger />
          <SyncPanel />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-6 sm:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
