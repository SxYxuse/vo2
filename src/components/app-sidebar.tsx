"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  LogOutIcon,
  MapIcon,
  MonitorIcon,
  MoonIcon,
  Settings2Icon,
  SunIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Vo2Mark, Vo2Wordmark } from "@/components/vo2-mark.tsx";
import { APP_NAME } from "@/lib/brand.ts";
import { authClient } from "@/lib/auth-client.ts";
import { appShellQueryOptions } from "@/lib/queries.ts";
import { isSettingsPath, SETTINGS_SECTIONS } from "@/lib/settings-sections.ts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

const TRAINING_NAV_ITEMS = [
  { title: "Calendar", to: "/", icon: CalendarDaysIcon },
  { title: "Week bucket", to: "/week-bucket", icon: ClipboardListIcon },
] as const;

const NAV_ITEMS = [
  { title: "Map", to: "/map", icon: MapIcon },
  { title: "Fitness", to: "/fitness", icon: TrendingUpIcon },
  { title: "Heart rate", to: "/heart-rate", icon: HeartPulseIcon },
  { title: "Tests", to: "/tests", icon: FlaskConicalIcon },
] as const;

function SidebarNavMenu({
  items,
  pathname,
}: {
  items: ReadonlyArray<(typeof TRAINING_NAV_ITEMS)[number] | (typeof NAV_ITEMS)[number]>;
  pathname: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
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
            render={
              <Link
                to={item.to}
                preload="viewport"
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                }}
              />
            }
          >
            <item.icon />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function SettingsNavMenu({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {SETTINGS_SECTIONS.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            isActive={pathname === `/settings/${item.id}`}
            tooltip={item.label}
            render={
              <Link
                to="/settings/$section"
                params={{ section: item.id }}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                }}
              />
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

export function AppSidebar() {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
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
              <SettingsNavMenu pathname={pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Training</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarNavMenu items={TRAINING_NAV_ITEMS} pathname={pathname} />
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarNavMenu items={NAV_ITEMS} pathname={pathname} />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="flex-row items-center group-data-[collapsible=icon]:flex-col">
        {inSettings ? (
          <SidebarMenuButton
            tooltip="Back"
            className="flex-1"
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              void router.navigate({ href: lastHref.current ?? "/" });
            }}
          >
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton
            tooltip="Settings"
            aria-label="Settings"
            className="w-auto"
            render={
              <Link to="/settings/$section" params={{ section: "profile" }} preload="intent" />
            }
          >
            <Settings2Icon />
          </SidebarMenuButton>
        )}
        <div className="ml-auto group-data-[collapsible=icon]:ml-0">
          <SidebarUserMenu />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function SidebarUserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const { data: session, isPending } = authClient.useSession();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const user = session?.user;

  useEffect(() => {
    setMounted(true);
  }, []);

  const initials = user?.name?.charAt(0).toUpperCase() || "V";
  const currentTheme = mounted ? (theme ?? "system") : "system";
  const currentOption =
    THEME_OPTIONS.find((option) => option.value === currentTheme) ?? THEME_OPTIONS[2];

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu
            modal={false}
            open={menuOpen}
            onOpenChange={(open) => {
              if (!open && themeOpen) return;
              setMenuOpen(open);
            }}
          >
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  aria-label={user?.name ?? "Account"}
                  className="w-auto p-1 data-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center"
                />
              }
            >
              {isPending ? (
                <Avatar size="sm">
                  <AvatarFallback>V</AvatarFallback>
                </Avatar>
              ) : (
                <Avatar size="sm">
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
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <div className="px-2 py-1.5" onPointerDown={(event) => event.stopPropagation()}>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="sidebar-theme">Theme</FieldLabel>
                    <Select
                      value={currentTheme}
                      open={themeOpen}
                      onOpenChange={setThemeOpen}
                      onValueChange={(next) => {
                        if (next == null) return;
                        setTheme(String(next));
                      }}
                    >
                      <SelectTrigger id="sidebar-theme" size="sm" className="ml-auto w-28">
                        <SelectValue>
                          <currentOption.icon />
                          {currentOption.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} align="end" side="top">
                        <SelectGroup>
                          {THEME_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <option.icon />
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </DropdownMenuGroup>
              {user ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        void authClient.signOut().then(async () => {
                          queryClient.setQueryData(appShellQueryOptions.queryKey, {
                            signedIn: false,
                            training: null,
                          });
                          queryClient.removeQueries({
                            predicate: (query) => query.queryKey[0] !== "app-shell",
                          });
                          await router.invalidate();
                          await router.navigate({ to: "/", replace: true });
                        });
                      }}
                    >
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
