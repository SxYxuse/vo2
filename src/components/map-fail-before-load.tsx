"use client";

import { useEffect } from "react";

import { useMap } from "@/components/ui/map";

// A stalled worker or style request fires no error, so give up on the basemap after this long.
const FIRST_LOAD_TIMEOUT_MS = 10_000;

/**
 * Hands over to the page's fallback when the basemap can't load (offline, weak signal). Only the
 * first load counts: a tile failing later, mid-pan, keeps the map.
 */
export function FailBeforeLoad({ onFail }: { onFail: () => void }) {
  const { map } = useMap();

  useEffect(() => {
    if (!map || map.loaded()) return;
    const timeout = window.setTimeout(onFail, FIRST_LOAD_TIMEOUT_MS);
    const stop = () => {
      window.clearTimeout(timeout);
      map.off("load", stop);
      map.off("error", handleError);
    };
    const handleError = () => {
      stop();
      onFail();
    };
    map.on("load", stop);
    map.on("error", handleError);
    return stop;
  }, [map, onFail]);

  return null;
}
