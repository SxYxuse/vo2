"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Feature, LineString } from "geojson";

import { boundsOf, type ActivityMapTrace, type LngLat } from "@/services/activity-map.types.ts";
import {
  Map as MapView,
  MapControls,
  MapGeoJSON,
  MapMarker,
  MarkerContent,
  useMap,
} from "@/components/ui/map";

import { resolveThemeColor } from "./map-theme-color.ts";

type ActivityDetailMapViewProps = {
  trace: ActivityMapTrace;
  color: string;
  /** False on the page card: a pannable map there catches the thumb while scrolling. */
  interactive: boolean;
  onFail: () => void;
};

function FitTrace({ bounds, padding }: { bounds: [LngLat, LngLat]; padding: number }) {
  const { map, isLoaded } = useMap();
  const latest = useRef(bounds);
  latest.current = bounds;

  useEffect(() => {
    if (!isLoaded || !map) return;
    map.fitBounds(latest.current, { padding, maxZoom: 15, duration: 0 });
  }, [isLoaded, map, padding]);

  return null;
}

// A stalled worker or style request fires no error, so give up on the basemap after this long.
const FIRST_LOAD_TIMEOUT_MS = 10_000;

/**
 * Hands over to the plain outline when the basemap can't load (offline, weak signal). Only the
 * first load counts: a tile failing later, mid-pan, keeps the map.
 */
function FailBeforeLoad({ onFail }: { onFail: () => void }) {
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

export function ActivityDetailMapView({
  trace,
  color,
  interactive,
  onFail,
}: ActivityDetailMapViewProps) {
  const viewport = useMemo(() => boundsOf(trace.coordinates), [trace]);
  const line = useMemo<Feature<LineString>>(
    () => ({
      type: "Feature",
      properties: { color: resolveThemeColor(color) },
      geometry: { type: "LineString", coordinates: trace.coordinates },
    }),
    [color, trace],
  );

  if (!viewport) return null;

  return (
    <MapView
      center={viewport.center}
      zoom={viewport.zoom}
      interactive={interactive}
      dragRotate={false}
      touchPitch={false}
    >
      <FailBeforeLoad onFail={onFail} />
      {viewport.bounds ? (
        <FitTrace bounds={viewport.bounds} padding={interactive ? 56 : 24} />
      ) : null}
      <MapGeoJSON
        data={{ type: "FeatureCollection", features: [line] }}
        fillPaint={false}
        linePaint={{ "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 0.95 }}
      />
      {[
        { point: trace.start, label: "Start", className: "bg-ds-green-700" },
        { point: trace.finish, label: "Finish", className: "bg-ds-gray-1000" },
      ].map(({ point, label, className }) => (
        <MapMarker key={label} longitude={point[0]} latitude={point[1]}>
          <MarkerContent>
            <span
              aria-label={label}
              className={`block size-3 rounded-full border-2 border-white shadow ${className}`}
            />
          </MarkerContent>
        </MapMarker>
      ))}
      {interactive ? <MapControls showZoom position="bottom-right" /> : null}
    </MapView>
  );
}
