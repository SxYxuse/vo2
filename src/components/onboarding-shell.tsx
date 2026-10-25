import type { ReactNode } from "react";
import { cn } from "cn";

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
      <main className="flex flex-1 justify-center px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10">
        {/* Top-aligned on phones so the first field sits in view. The document scrolls, not main,
            so the step footer can pin to the screen. */}
        <div className="w-full max-w-lg sm:my-auto">{children}</div>
      </main>
    </div>
  );
}

/**
 * Footer that stays at the bottom of the screen on long steps, so the next action is always
 * under the thumb. Pair it with `SETUP_CARD` on the card around it.
 */
export const SETUP_FOOTER =
  "sticky bottom-0 z-10 flex-wrap justify-end gap-2 rounded-b-lg border-t bg-card pb-(--card-spacing) max-sm:pb-[max(var(--card-spacing),env(safe-area-inset-bottom))]";

/** Sticky needs the card to let its footer escape: no clipping, no bottom padding of its own. */
export const SETUP_CARD = "overflow-visible pb-0";

export const SETUP_STEP_TITLES = [
  "Copy from Strava",
  "About you",
  "Your sports",
  "Your plan",
  "You're set",
] as const;

/**
 * One progress bar for the whole setup. The plan step has its own sub-steps; they fill its
 * segment in parts so the athlete never sees a second, unrelated stepper.
 */
export function SetupProgress({
  step,
  substep,
  onSelect,
  locked = false,
}: {
  step: number;
  substep?: { index: number; count: number; title?: string };
  /** Going back to an earlier step; later steps stay closed. */
  onSelect?: (step: number) => void;
  locked?: boolean;
}) {
  const total = SETUP_STEP_TITLES.length;
  const title = SETUP_STEP_TITLES[step];
  return (
    <div className="flex w-full flex-col gap-1.5">
      <p className="text-muted-foreground text-xs">
        Step {step + 1} of {total} · {title}
        {substep ? ` · ${substep.title ?? `${substep.index + 1} of ${substep.count}`}` : null}
      </p>
      <ol aria-label="Setup steps" className="flex gap-1">
        {SETUP_STEP_TITLES.map((item, index) => {
          const done = index < step;
          const current = index === step;
          const open = !locked && done && onSelect != null;
          return (
            <li key={item} className="flex-1">
              <button
                type="button"
                aria-label={`${item}${done ? ", done" : current ? ", current step" : ""}`}
                aria-current={current ? "step" : undefined}
                disabled={!open}
                onClick={() => onSelect?.(index)}
                className="flex w-full py-2 disabled:cursor-default"
              >
                <span className="bg-muted flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
                  {current && substep ? (
                    Array.from({ length: substep.count }, (_, part) => (
                      <span
                        key={part}
                        className={cn(
                          "h-full flex-1 transition-colors",
                          part <= substep.index ? "bg-primary" : "bg-primary/15",
                        )}
                      />
                    ))
                  ) : (
                    <span
                      className={cn(
                        "h-full flex-1 transition-colors",
                        done ? "bg-primary/60" : current ? "bg-primary" : "bg-transparent",
                      )}
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
