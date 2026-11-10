"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FlagIcon,
  TargetIcon,
  HeartPulseIcon,
  LogOutIcon,
  MapIcon,
  RouteIcon,
  Settings2Icon,
  SparklesIcon,
  TrendingUpIcon,
  TrophyIcon,
  ZapIcon,
} from "lucide-react";

import { Vo2Mark, Vo2Wordmark } from "@/components/vo2-mark.tsx";
import { APP_NAME } from "@/lib/brand.ts";
import { appShellQueryOptions } from "@/lib/app-shell-query.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useSignOut } from "@/hooks/use-sign-out.ts";
import { useThemeToggle } from "@/hooks/use-theme-toggle.ts";
import {
  isSettingsPath,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  showsSettingsSection,
} from "@/lib/settings-sections.ts";
import { cn } from "@/lib/utils";
import type { SettingsSnapshot } from "@/services/athlete-settings.ts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

const TRAINING_NAV_ITEMS = [
  { title: "Calendar", to: "/", icon: CalendarDaysIcon },
  { title: "Plan", to: "/week", icon: TargetIcon },
  { title: "Season", to: "/season", icon: FlagIcon },
  { title: "Coach", to: "/coach", icon: SparklesIcon },
] as const;

/**
 * Phones get 44px footer buttons so they are easy to tap clear of the rounded screen corner.
 * Sized in rem because this theme's --spacing is 0.24rem, so size-11 would be only 42px.
 */
const MOBILE_FOOTER_BUTTON = "size-[2.75rem] justify-center [&_svg]:size-5";

const COLLAPSIBLE_NAV_GROUPS = [
  {
    id: "progress",
    label: "Progress",
    items: [
      { title: "Fitness", to: "/fitness", icon: TrendingUpIcon },
      { title: "Bests", to: "/bests", icon: TrophyIcon },
      { title: "Heart rate", to: "/heart-rate", icon: HeartPulseIcon },
      { title: "Power", to: "/power", icon: ZapIcon },
    ],
  },
  {
    id: "routes",
    label: "Routes",
    items: [
      { title: "Map", to: "/map", icon: MapIcon },
      { title: "Merge GPX", to: "/merge-gpx", icon: RouteIcon },
    ],
  },
] as const;

type NavItem =
  | (typeof TRAINING_NAV_ITEMS)[number]
  | (typeof COLLAPSIBLE_NAV_GROUPS)[number]["items"][number];

const CLOSED_GROUPS_KEY = "vo2.sidebar.closed";

function readClosedGroups(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CLOSED_GROUPS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeClosedGroups(ids: string[]) {
  try {
    window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(ids));
  } catch {
    // Private mode or full storage: the choice still holds until the app is closed.
  }
}

/**
 * A nav group the athlete can fold away, remembered on this device. The group holding the
 * current page always shows, so a link never lands on a page hidden in the sidebar; in the
 * desktop icon rail the labels are gone, so every group shows its icons.
 */
function CollapsibleNavGroup({
  group,
  pathname,
  onLinkClick,
}: {
  group: (typeof COLLAPSIBLE_NAV_GROUPS)[number];
  pathname: string;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { isMobile, state } = useSidebar();
  const [closed, setClosed] = useState(false);
  // Read after mount: the server render has no storage, and both must match.
  useEffect(() => setClosed(readClosedGroups().includes(group.id)), [group.id]);
  const holdsCurrentPage = group.items.some((item) => isActiveNavItem(item, pathname));
  const iconRail = !isMobile && state === "collapsed";
  const open = iconRail || holdsCurrentPage || !closed;

  const onOpenChange = (next: boolean) => {
    setClosed(!next);
    const others = readClosedGroups().filter((id) => id !== group.id);
    writeClosedGroups(next ? others : [...others, group.id]);
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} render={<SidebarGroup />}>
      <SidebarGroupLabel
        render={<CollapsibleTrigger />}
        className={cn(
          "group/label w-full cursor-pointer justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:pointer-events-none",
          isMobile && "h-[2.75rem] text-sm",
        )}
      >
        {group.label}
        <ChevronRightIcon
          aria-hidden
          className="transition-transform group-data-panel-open/label:rotate-90"
        />
      </SidebarGroupLabel>
      <CollapsibleContent render={<SidebarGroupContent />}>
        <SidebarNavMenu items={group.items} pathname={pathname} onLinkClick={onLinkClick} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function isActiveNavItem(item: NavItem, pathname: string) {
  if (item.to === "/") return pathname === "/" || pathname.startsWith("/activities/");
  // A power file's analysis belongs to Power.
  return pathname === item.to || (item.to === "/power" && pathname.startsWith("/power/"));
}

function SidebarNavMenu({
  items,
  pathname,
  onLinkClick,
}: {
  items: ReadonlyArray<NavItem>;
  pathname: string;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            isActive={isActiveNavItem(item, pathname)}
            tooltip={item.title}
            render={<Link to={item.to} preload="viewport" onClick={onLinkClick} />}
          >
            <item.icon />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function SettingsNavMenu({
  pathname,
  onLinkClick,
}: {
  pathname: string;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  // Read from the cache the settings form fills, so the shell doesn't load the settings service.
  const { data } = useQuery<SettingsSnapshot>({ queryKey: ["settings-snapshot"], enabled: false });
  const sections = SETTINGS_SECTIONS.filter((item) =>
    showsSettingsSection(item.id, data?.settings.sportTypes),
  );
  return SETTINGS_GROUPS.map((group) => (
    <SidebarGroup key={group.id}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {sections
            .filter((item) => item.group === group.id)
            .map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={pathname === `/settings/${item.id}`}
                  tooltip={item.label}
                  render={
                    <Link
                      to="/settings/$section"
                      params={{ section: item.id }}
                      onClick={onLinkClick}
                    />
                  }
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}

/** Remembers the last page outside settings so Back can return to it. */
function useLastHrefOutsideSettings() {
  const location = useRouterState({ select: (state) => state.location });
  const lastHref = useRef<string | null>(null);
  useEffect(() => {
    if (!isSettingsPath(location.pathname)) lastHref.current = location.href;
  }, [location.pathname, location.href]);
  return lastHref;
}

/**
 * Router state is a sync external store, so React renders the next page in one blocking task
 * and nothing paints until it is built (a few hundred ms for the calendar). Show the
 * destination in the sidebar first, let that paint, then navigate, so a tap answers at once.
 */
function useSidebarNavigate() {
  const router = useRouter();
  const routerPathname = useRouterState({ select: (state) => state.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const [pendingPathname, setPendingPathname] = useState<string | null>(null);

  const navigate = (href: string, { keepOpen = false } = {}) => {
    if (isMobile && !keepOpen) setOpenMobile(false);
    setPendingPathname(new URL(href, window.location.origin).pathname);
    requestAnimationFrame(() => {
      setTimeout(() => {
        void router.navigate({ href }).finally(() => setPendingPathname(null));
      }, 0);
    });
  };

  const onLinkClick = (event: MouseEvent<HTMLAnchorElement>, options?: { keepOpen?: boolean }) => {
    const href = event.currentTarget.getAttribute("href");
    if (
      !href ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(href, options);
  };

  return { pathname: pendingPathname ?? routerPathname, navigate, onLinkClick };
}

export function AppSidebar() {
  const { pathname, navigate, onLinkClick } = useSidebarNavigate();
  const { isMobile } = useSidebar();
  const lastHref = useLastHrefOutsideSettings();
  const inSettings = isSettingsPath(pathname);
  const { data: shell } = useSuspenseQuery(appShellQueryOptions);
  // With planning off, Plan leaves the sidebar: its page says so, reached from Settings.
  const trainingItems =
    shell.planningStyle === "off"
      ? TRAINING_NAV_ITEMS.filter((item) => item.to !== "/week")
      : TRAINING_NAV_ITEMS;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={APP_NAME}
              render={<Link to="/" preload="viewport" />}
            >
              <Vo2Mark className="hidden group-data-[collapsible=icon]:block" />
              <Vo2Wordmark className="text-lg font-semibold group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {inSettings ? (
          <>
            {/* The way out of settings sits first, where the eye starts. */}
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Back to the app"
                    className={cn(isMobile && "h-[2.75rem] [&_svg]:size-5")}
                    onClick={() => navigate(lastHref.current ?? "/")}
                  >
                    <ArrowLeftIcon />
                    <span>Back to the app</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <SettingsNavMenu pathname={pathname} onLinkClick={onLinkClick} />
          </>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Training</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarNavMenu
                  items={trainingItems}
                  pathname={pathname}
                  onLinkClick={onLinkClick}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            {COLLAPSIBLE_NAV_GROUPS.map((group) => (
              <CollapsibleNavGroup
                key={group.id}
                group={group}
                pathname={pathname}
                onLinkClick={onLinkClick}
              />
            ))}
          </>
        )}
      </SidebarContent>
      {/* On phones the buttons sit low, beside the home indicator, and the wide side padding
          keeps them inside the rounded screen corner instead of lifting them above it. */}
      <SidebarFooter
        className={cn(
          "flex-row items-center group-data-[collapsible=icon]:flex-col",
          isMobile
            ? "px-[1.5rem] pb-[max(0.5rem,calc(env(safe-area-inset-bottom)-1.25rem))]"
            : "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        )}
      >
        {inSettings ? null : (
          <SidebarMenuButton
            tooltip="Settings"
            aria-label="Settings"
            className={isMobile ? MOBILE_FOOTER_BUTTON : "w-auto"}
            render={<Link to="/settings" preload="intent" onClick={onLinkClick} />}
          >
            <Settings2Icon />
          </SidebarMenuButton>
        )}
        <SidebarThemeButton />
        <div className="ml-auto group-data-[collapsible=icon]:ml-0">
          <SidebarUserMenu />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function SidebarThemeButton() {
  const { mounted, current, next, toggle } = useThemeToggle();
  const { isMobile } = useSidebar();
  const label = mounted ? `Theme: ${current.label}. Switch to ${next.label}` : "Theme";

  return (
    <SidebarMenuButton
      tooltip={label}
      aria-label={label}
      className={isMobile ? MOBILE_FOOTER_BUTTON : "w-auto"}
      disabled={!mounted}
      onClick={toggle}
    >
      {mounted ? <current.icon /> : <span aria-hidden className={isMobile ? "size-5" : "size-4"} />}
    </SidebarMenuButton>
  );
}

function SidebarUserMenu() {
  const signOut = useSignOut();
  const { isMobile } = useSidebar();
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;
  const initials = user?.name?.charAt(0).toUpperCase() || "V";

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  aria-label={user?.name ?? "Account"}
                  className={cn(
                    "rounded-full p-1 data-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center",
                    isMobile ? MOBILE_FOOTER_BUTTON : "w-auto",
                  )}
                />
              }
            >
              {isPending ? (
                <Avatar size={isMobile ? "default" : "sm"}>
                  <AvatarFallback>V</AvatarFallback>
                </Avatar>
              ) : (
                <Avatar size={isMobile ? "default" : "sm"}>
                  {user?.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? "top" : "right"}
              align="end"
              sideOffset={8}
              className="min-w-56"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>{user?.name ?? "Account"}</DropdownMenuLabel>
              </DropdownMenuGroup>
              {user ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                      <LogOutIcon />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
