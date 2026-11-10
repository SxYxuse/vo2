"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CalendarDaysIcon,
  EllipsisIcon,
  FlagIcon,
  SparklesIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";

import { appShellQueryOptions } from "@/lib/app-shell-query.ts";
import { useSidebar } from "@/components/ui/sidebar";

type Tab = { title: string; to: string; icon: LucideIcon; matches: (pathname: string) => boolean };

const TABS: Tab[] = [
  {
    title: "Calendar",
    to: "/",
    icon: CalendarDaysIcon,
    matches: (pathname) => pathname === "/" || pathname.startsWith("/activities/"),
  },
  {
    title: "Plan",
    to: "/week",
    icon: TargetIcon,
    matches: (pathname) => pathname === "/week" || pathname.startsWith("/week/"),
  },
  { title: "Season", to: "/season", icon: FlagIcon, matches: (pathname) => pathname === "/season" },
  {
    title: "Coach",
    to: "/coach",
    icon: SparklesIcon,
    matches: (pathname) => pathname === "/coach",
  },
];

const TAB_CLASS =
  "flex min-h-[2.75rem] flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

// Like an iOS tab bar: the active tab is drawn solid with a heavier stroke, the rest muted.
function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return <Icon aria-hidden className="size-6" strokeWidth={active ? 2.25 : 1.75} />;
}

/**
 * Phones get the main screens at the bottom, where the thumb rests; More opens the full menu.
 * Desktop keeps the sidebar alone. It never moves while a field has focus: a bar that stepped
 * aside for the keyboard came back mid-tap when the tap blurred the field, and the tap missed.
 */
export function TabBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  const { openMobile, setOpenMobile } = useSidebar();
  // With planning off, Plan leaves the tabs as it leaves the sidebar.
  const tabs = shell.planningStyle === "off" ? TABS.filter((tab) => tab.to !== "/week") : TABS;
  // A page with no tab of its own lights More, which leads to it; Plan with planning off has
  // neither, so nothing lights.
  const onTab = tabs.some((tab) => tab.matches(pathname));
  const moreActive = openMobile || (!onTab && !TABS.some((tab) => tab.matches(pathname)));

  return (
    <nav
      data-slot="tab-bar"
      aria-label="Main"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 flex border-t px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((tab) => {
        const active = !openMobile && tab.matches(pathname);
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
