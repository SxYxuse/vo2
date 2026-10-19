import type { SyncKind } from "./strava-sync.types.ts";

export type OnboardingSyncAction = "start" | "sync" | "retry" | null;

export type OnboardingSyncPhase = SyncKind | "syncing";

export type OnboardingSyncStep = {
  canContinue: boolean;
  action: OnboardingSyncAction;
  phase: OnboardingSyncPhase;
};

/**
 * Gate for the first onboarding step. `syncFailed` and `syncPaused` describe the sync run
 * in this session: a pause still lets the athlete move on after its window has passed and
 * the stored copy reads incomplete again.
 */
export function onboardingSyncStep(input: {
  status: SyncKind;
  syncing: boolean;
  syncFailed: boolean;
  syncPaused: boolean;
}): OnboardingSyncStep {
  if (input.syncing) return { canContinue: false, action: null, phase: "syncing" };
  if (input.status === "complete") return { canContinue: true, action: null, phase: "complete" };
  if (input.status === "paused") return { canContinue: true, action: null, phase: "paused" };
  if (input.syncFailed || input.status === "failed") {
    return { canContinue: true, action: "retry", phase: "failed" };
  }
  if (input.syncPaused) return { canContinue: true, action: "sync", phase: "paused" };
  if (input.status === "incomplete") {
    return { canContinue: false, action: "sync", phase: "incomplete" };
  }
  return { canContinue: false, action: "start", phase: "never" };
}
