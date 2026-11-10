"use client";

import { useEffect } from "react";

import { SignInPanel } from "@/components/sign-in-panel.tsx";
import { Vo2Mark, Vo2Wordmark } from "@/components/vo2-mark.tsx";
import { APP_NAME } from "@/lib/brand.ts";
import { removeCoachChats } from "@/lib/coach-storage.ts";
import { Button } from "@/components/ui/button";
import { useThemeToggle } from "@/hooks/use-theme-toggle.ts";

export function SignedOutPage() {
  // Sign-out clears the coach chat, but an athlete deleted from Strava's side lands here
  // without signing out.
  useEffect(() => {
    void removeCoachChats();
  }, []);
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center text-lg font-semibold">
          <Vo2Wordmark />
        </div>
        <ThemeToggleButton />
      </header>
      <main className="flex flex-1 flex-col justify-center px-4 pt-8 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          <Vo2Mark className="size-14 rounded-2xl shadow-sm" />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in with Strava</h1>
            <p className="text-muted-foreground text-pretty">
              {APP_NAME} copies your Strava activities, scores your fitness and form, and plans your
              training weeks toward your goals.
            </p>
          </div>
          <SignInPanel />
          <p className="text-muted-foreground text-xs text-pretty">
            {APP_NAME} only reads from Strava. Your activities stay on Strava, and you can delete
            your {APP_NAME} data at any time in Settings.
          </p>
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
