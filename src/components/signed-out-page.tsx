"use client";

import { SignInPanel } from "@/components/sync-panel.tsx";
import { Vo2Wordmark } from "@/components/vo2-mark.tsx";
import { APP_NAME } from "@/lib/brand.ts";
import { Button } from "@/components/ui/button";
import { useThemeToggle } from "@/hooks/use-theme-toggle.ts";

export function SignedOutPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center text-lg font-semibold">
          <Vo2Wordmark />
        </div>
        <ThemeToggleButton />
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
          <SignInPanel />
        </div>
      </main>
    </div>
  );
}

function ThemeToggleButton() {
  const { mounted, current, next, toggle } = useThemeToggle();
  const Icon = current.icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={mounted ? `Theme: ${current.label}. Switch to ${next.label}` : "Theme"}
      disabled={!mounted}
      onClick={toggle}
    >
      {mounted ? <Icon /> : <span aria-hidden className="size-3.5" />}
    </Button>
  );
}
