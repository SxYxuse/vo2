"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  TargetIcon,
  HeartPulseIcon,
  LogOutIcon,
  MapIcon,
  RouteIcon,
  Settings2Icon,
  TrendingUpIcon,
} from "lucide-react";

import { Vo2Mark, Vo2Wordmark } from "@/components/vo2-mark.tsx";
import { APP_NAME } from "@/lib/brand.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useSignOut } from "@/hooks/use-sign-out.ts";
import { useThemeToggle } from "@/hooks/use-theme-toggle.ts";
import { isSettingsPath, SETTINGS_SECTIONS } from "@/lib/settings-sections.ts";
import { cn } from "@/lib/utils";
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
  { title: "Week target", to: "/week", icon: TargetIcon },
  { title: "Fuel", to: "/fuel", icon: RouteIcon },
] as const;

/**
 * Phones get 44px footer buttons so they are easy to tap clear of the rounded screen corner.
 * Sized in rem because this theme's --spacing is 0.24rem, so size-11 would be only 42px.
 */
const MOBILE_FOOTER_BUTTON = "size-[2.75rem] justify-center [&_svg]:size-5";

const NAV_ITEMS = [
  { title: "Map", to: "/map", icon: MapIcon },
  { title: "Fitness", to: "/fitness", icon: TrendingUpIcon },
  { title: "Heart rate", to: "/heart-rate", icon: HeartPulseIcon },
] as const;

function SidebarNavMenu({
  items,
  pathname,
  onLinkClick,
}: {
  items: ReadonlyArray<(typeof TRAINING_NAV_ITEMS)[number] | (typeof NAV_ITEMS)[number]>;
  pathname: string;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            isActive={
              item.to === "/"
                ? pathname === "/" || pathname.startsWith("/activities/")
                : pathname === item.to
            }
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
  return (
    <SidebarMenu>
      {SETTINGS_SECTIONS.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            isActive={pathname === `/settings/${item.id}`}
            tooltip={item.label}
            render={
              <Link to="/settings/$section" params={{ section: item.id }} onClick={onLinkClick} />
            }
          >
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
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
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarGroupContent>
              <SettingsNavMenu pathname={pathname} onLinkClick={onLinkClick} />
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Training</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarNavMenu
                  items={TRAINING_NAV_ITEMS}
                  pathname={pathname}
                  onLinkClick={onLinkClick}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarNavMenu items={NAV_ITEMS} pathname={pathname} onLinkClick={onLinkClick} />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarFooter
        className={cn(
          "flex-row items-center group-data-[collapsible=icon]:flex-col",
          isMobile
            ? "px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
            : "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        )}
      >
        {inSettings ? (
          <SidebarMenuButton
            tooltip="Back"
            className={cn("flex-1", isMobile && "h-[2.75rem] [&_svg]:size-5")}
            onClick={() => navigate(lastHref.current ?? "/")}
          >
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton
            tooltip="Settings"
            aria-label="Settings"
            className={isMobile ? MOBILE_FOOTER_BUTTON : "w-auto"}
            render={
              <Link
                to="/settings/$section"
                params={{ section: "profile" }}
                preload="intent"
                // Phones keep the sheet open so the athlete can pick a section.
                onClick={(event) => onLinkClick(event, { keepOpen: true })}
              />
            }
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
