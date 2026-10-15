import { useSyncExternalStore } from "react";

export const DESKTOP_MQ = "(min-width: 768px)";

type Listener = () => void;

const listeners = new Set<Listener>();
let desktopQuery: MediaQueryList | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: Listener) {
  if (typeof window === "undefined") return () => {};
  if (!desktopQuery) {
    desktopQuery = window.matchMedia(DESKTOP_MQ);
    desktopQuery.addEventListener("change", emit);
  }
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getDesktopSnapshot() {
  desktopQuery ??= window.matchMedia(DESKTOP_MQ);
  return desktopQuery.matches;
}

export function readIsDesktop() {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

/** `null` on the server until the client snapshot runs, so SSR does not assume a layout. */
export function useDesktopMedia(): boolean | null {
  return useSyncExternalStore(subscribe, getDesktopSnapshot, () => null);
}

export function useIsDesktop() {
  return useDesktopMedia() ?? false;
}
