import type { ReactNode } from "react";

import { Vo2Wordmark } from "@/components/vo2-mark.tsx";

// Its own module: the onboarding route's pending component stays in the main bundle, and the
// forms in onboarding.tsx should not ride along with it.
export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-6">
        <div className="flex items-center text-lg font-semibold">
          <Vo2Wordmark />
        </div>
      </header>
      <main className="flex flex-1 justify-center overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        <div className="my-auto w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
