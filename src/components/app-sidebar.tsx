"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { noop, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
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

const OnboardingDialog = lazy(() =>
  import("#/components/onboarding-dialog.tsx").then((mod) => ({ default: mod.OnboardingDialog })),
);
const SettingsDialog = lazy(() =>
  import("#/components/settings-dialog.tsx").then((mod) => ({ default: mod.SettingsDialog })),
);

import { Vo2Mark, Vo2Wordmark } from "#/components/vo2-mark.tsx";
import { APP_NAME } from "#/lib/brand.ts";
import { authClient } from "#/lib/auth-client.ts";
import { appShellQueryOptions, settingsSnapshotQueryOptions } from "#/lib/queries.ts";
import { isTrainingPlanComplete } from "#/services/training-plan.ts";
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

const NAV_ITEMS = [
  { title: "Calendar", to: "/", icon: CalendarDaysIcon },
  { title: "Map", to: "/map", icon: MapIcon },
  { title: "Fitness", to: "/fitness", icon: TrendingUpIcon },
  { title: "Heart rate", to: "/heart-rate", icon: HeartPulseIcon },
  { title: "Tests", to: "/tests", icon: FlaskConicalIcon },
] as const;

function preloadSettingsDialog(queryClient?: ReturnType<typeof useQueryClient>) {
  void import("#/components/onboarding-dialog.tsx");
  void import("#/components/settings-dialog.tsx");
  void queryClient?.query(settingsSnapshotQueryOptions).catch(noop);
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const { data: shell } = useQuery({
    ...appShellQueryOptions,
    enabled: Boolean(user),
  });
  const trainingMissing = Boolean(
    user && shell?.signedIn && !isTrainingPlanComplete(shell.training),
  );

  useEffect(() => {
    if (!trainingMissing) return;
    preloadSettingsDialog(queryClient);
    setOnboardingOpen(true);
  }, [trainingMissing, queryClient]);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip={APP_NAME} render={<Link to="/" preload="viewport" />}>
                <Vo2Mark className="hidden group-data-[collapsible=icon]:block" />
                <Vo2Wordmark className="text-lg font-semibold group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigate</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={pathname === item.to}
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
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarUserMenu
            onOpenSettings={() => setSettingsOpen(true)}
            onHoverSettings={() => preloadSettingsDialog(queryClient)}
          />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {user && (onboardingOpen || settingsOpen) ? (
        <Suspense fallback={null}>
          {onboardingOpen ? (
            <OnboardingDialog
              open={onboardingOpen}
              onOpenChange={setOnboardingOpen}
              userName={user.name}
            />
          ) : null}
          {settingsOpen ? (
            <SettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              userName={user.name}
            />
          ) : null}
        </Suspense>
      ) : null}
    </>
  );
}

function SidebarUserMenu({
  onOpenSettings,
  onHoverSettings,
}: {
  onOpenSettings: () => void;
  onHoverSettings: () => void;
}) {
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
                <SidebarMenuButton className="data-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center" />
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
              <span className="truncate font-medium group-data-[collapsible=icon]:hidden">
                {user?.name ?? "Guest"}
              </span>
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
                      onMouseEnter={onHoverSettings}
                      onFocus={onHoverSettings}
                      onPointerDown={onHoverSettings}
                      onClick={() => {
                        onOpenSettings();
                      }}
                    >
                      <Settings2Icon />
                      Settings
                    </DropdownMenuItem>
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
