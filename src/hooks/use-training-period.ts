import { useSyncExternalStore } from "react";

import { useDesktopMedia } from "@/hooks/use-desktop-media.ts";
import { FITNESS_PERIODS, type FitnessPeriod } from "@/services/training-load.ts";

const STORAGE_KEY = "vo2.period";

type Listener = () => void;

const listeners = new Set<Listener>();
let chosen: FitnessPeriod | null | undefined;

function isPeriod(value: unknown): value is FitnessPeriod {
  return FITNESS_PERIODS.some((item) => item.id === value);
}

function readStored(): FitnessPeriod | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isPeriod(value) ? value : null;
  } catch {
    return null;
  }
}

function subscribe(onStoreChange: Listener) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot() {
  if (chosen === undefined) chosen = readStored();
  return chosen;
}

export function setTrainingPeriod(period: FitnessPeriod) {
  chosen = period;
  try {
    window.localStorage.setItem(STORAGE_KEY, period);
  } catch {
    // Private mode or full storage: the choice still holds for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * The one period every training view shares (fitness, heart rate). A choice made on one page
 * carries to the others and survives app restarts. `null` until the client knows the layout.
 */
export function useTrainingPeriod(): FitnessPeriod | null {
  const isDesktop = useDesktopMedia();
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (isDesktop === null) return null;
  return stored ?? (isDesktop ? "3m" : "7d");
}
