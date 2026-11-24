"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import { EllipsisIcon, type LucideIcon } from "lucide-react";

import { appShellQueryOptions } from "@/lib/app-shell-query.ts";
import { trainingNavFor, type TrainingNavItem } from "@/components/training-nav.ts";
import { useSidebar } from "@/components/ui/sidebar";

const TAB_MATCHES: Record<TrainingNavItem["to"], (pathname: string) => boolean> = {
  "/": (pathname) => pathname === "/" || pathname.startsWith("/activities/"),
  "/week": (pathname) => pathname === "/week" || pathname.startsWith("/week/"),
  "/season": (pathname) => pathname === "/season",
  "/coach": (pathname) => pathname === "/coach",
};

const onAnyTab = (pathname: string) =>
  Object.values(TAB_MATCHES).some((matches) => matches(pathname));

const TAB_CLASS =
  "flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return <Icon aria-hidden className="size-6" strokeWidth={active ? 2.25 : 1.75} />;
}

export function TabBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  const { openMobile, setOpenMobile } = useSidebar();
  const tabs = trainingNavFor(shell.planningStyle);
  const moreActive = openMobile || !onAnyTab(pathname);

  return (
    <nav
      data-slot="tab-bar"
      aria-label="Main"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 flex border-t px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((tab) => {
        const active = !openMobile && TAB_MATCHES[tab.to](pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              TAB_CLASS,
              "h-[3.5rem]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <TabIcon icon={tab.icon} active={active} />
            {tab.title}
          </Link>
        );
      })}
      <button
        type="button"
        aria-expanded={openMobile}
        aria-haspopup="dialog"
        onClick={() => setOpenMobile(true)}
        className={cn(
          TAB_CLASS,
          "h-[3.5rem]",
          moreActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <TabIcon icon={EllipsisIcon} active={moreActive} />
        More
      </button>
    </nav>
  );
}
