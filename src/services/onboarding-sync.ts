import type { SyncKind } from "./strava-sync.types.ts";

type OnboardingSyncAction = "start" | "sync" | "retry" | null;

export type OnboardingSyncPhase = SyncKind | "syncing";

export type OnboardingSyncStep = {
  canContinue: boolean;
  action: OnboardingSyncAction;
  phase: OnboardingSyncPhase;
};

export function onboardingSyncStep(input: {
  status: SyncKind;
  syncing: boolean;
  syncFailed: boolean;
  syncPaused: boolean;
  activityCount: number;
}): OnboardingSyncStep {
  const newestPageCopied = input.activityCount > 0;
  if (input.syncing) return { canContinue: newestPageCopied, action: null, phase: "syncing" };
  if (input.status === "complete") return { canContinue: true, action: null, phase: "complete" };
  if (input.status === "paused") return { canContinue: true, action: null, phase: "paused" };
  if (input.syncFailed || input.status === "failed") {
    return { canContinue: true, action: "retry", phase: "failed" };
  }
  if (input.syncPaused) return { canContinue: true, action: "sync", phase: "paused" };
  if (input.status === "incomplete") {
    return { canContinue: newestPageCopied, action: "sync", phase: "incomplete" };
  }
  return { canContinue: false, action: "start", phase: "never" };
}
