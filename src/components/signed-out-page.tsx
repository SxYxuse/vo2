"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { SignInPanel } from "#/components/sync-panel.tsx";
import { Vo2Mark, Vo2Wordmark } from "#/components/vo2-mark.tsx";
import { APP_NAME } from "#/lib/brand.ts";
import { Button } from "@/components/ui/button";

const THEME_CYCLE = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function SignedOutPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Vo2Mark className="size-4" />
          <Vo2Wordmark />
        </div>
        <ThemeCycleButton />
      </header>
      <main className="flex flex-1 flex-col px-4 pt-16 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-24">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Sign in with Strava
            </h1>
            <p className="text-muted-foreground text-sm">
              {APP_NAME} imports your activities, then you can use the calendar, map, fitness, heart
              rate, and tests.
            </p>
          </div>
          <SignInPanel description={false} />
        </div>
      </main>
    </div>
  );
}

function ThemeCycleButton() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = THEME_CYCLE.find((option) => option.value === theme) ?? THEME_CYCLE[2];
  const next =
    THEME_CYCLE[
      (THEME_CYCLE.findIndex((option) => option.value === current.value) + 1) % THEME_CYCLE.length
    ];
  const Icon = current.icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={mounted ? `Theme: ${current.label}. Switch to ${next.label}` : "Theme"}
      disabled={!mounted}
      onClick={() => setTheme(next.value)}
    >
      {mounted ? <Icon /> : <span aria-hidden className="size-3.5" />}
    </Button>
  );
}
