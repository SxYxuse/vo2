"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FeatureCollection, LineString, Polygon } from "geojson";
import type { LineLayerSpecification } from "maplibre-gl";

import type { LngLat } from "@/services/activity-map.types.ts";
import type { ProposedRoute, StretchFit } from "@/services/route-builder.types.ts";
import { destination } from "@/services/route-scoring.ts";
import {
  Map as MapView,
  MapControls,
  MapGeoJSON,
  MapMarker,
  MarkerContent,
  useMap,
} from "@/components/ui/map";

import { FailBeforeLoad } from "./map-fail-before-load.tsx";
import { resolveThemeColor } from "./map-theme-color.ts";
import { FIT_STYLE } from "./route-builder-style.ts";

export type RouteBuilderMapViewProps = {
  /** Null until the athlete places one; the map then opens on `center`. */
  start: LngLat | null;
  center: LngLat;
  zoneRadiusKm: number;
  routes: ProposedRoute[];
  selectedId: string | null;
  onStartChange: (start: LngLat) => void;
  onFail: () => void;
};

function zoneRing(start: LngLat, radiusKm: number): LngLat[] {
  return Array.from({ length: 73 }, (_, index) =>
    destination(start, (index * 360) / 72, radiusKm * 1000),
  );
}

/** Frames the zone when it moves or grows, so the whole of it stays in view. */
function FitZone({ start, zoneRadiusKm }: { start: LngLat | null; zoneRadiusKm: number }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!isLoaded || !map || !start) return;
    const ring = zoneRing(start, zoneRadiusKm);
    const lngs = ring.map(([lng]) => lng);
    const lats = ring.map(([, lat]) => lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 24, duration: 300 },
    );
  }, [isLoaded, map, start, zoneRadiusKm]);
  return null;
}

/** A tap on the map moves the start, and the zone with it. */
function TapToMoveStart({ onStartChange }: { onStartChange: (start: LngLat) => void }) {
  const { map, isLoaded } = useMap();
  const latest = useRef(onStartChange);
  latest.current = onStartChange;
  useEffect(() => {
    if (!isLoaded || !map) return;
    const handle = (event: { lngLat: { lng: number; lat: number } }) =>
      latest.current([event.lngLat.lng, event.lngLat.lat]);
    map.on("click", handle);
    return () => {
      map.off("click", handle);
    };
  }, [isLoaded, map]);
  return null;
}

const CASING_PAINT: LineLayerSpecification["paint"] = {
  "line-color": "#ffffff",
  "line-width": 8,
  "line-opacity": 0.9,
};
const STRETCH_PAINT: LineLayerSpecification["paint"] = {
  "line-color": ["get", "color"],
  "line-width": 4.5,
};

export function RouteBuilderMapView({
  start,
  center,
  zoneRadiusKm,
  routes,
  selectedId,
  onStartChange,
  onFail,
}: RouteBuilderMapViewProps) {
  const colors = useMemo(() => {
    const resolved = {} as Record<StretchFit, string>;
    for (const fit of Object.keys(FIT_STYLE) as StretchFit[]) {
      resolved[fit] = resolveThemeColor(FIT_STYLE[fit].color);
    }
    return resolved;
  }, []);
  const muted = useMemo(() => resolveThemeColor("var(--color-ds-gray-700)"), []);
  const zoneColor = useMemo(() => resolveThemeColor("var(--color-ds-blue-700)"), []);

  const zone = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: start
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [zoneRing(start, zoneRadiusKm)] },
            },
          ]
        : [],
    }),
    [start, zoneRadiusKm],
  );

  const selected = routes.find((route) => route.id === selectedId) ?? null;
  const others = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: routes
        .filter((route) => route.id !== selectedId)
        .map((route) => ({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: route.coordinates.map(([lng, lat]) => [lng, lat]),
          },
        })),
    }),
    [routes, selectedId],
  );
  const stretches = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: (selected?.stretches ?? []).map((stretch) => ({
        type: "Feature",
        properties: { color: colors[stretch.fit] },
        geometry: { type: "LineString", coordinates: stretch.coordinates },
      })),
    }),
    [colors, selected],
  );

  const zonePaint = useMemo(() => ({ "fill-color": zoneColor, "fill-opacity": 0.06 }), [zoneColor]);
  const zoneLine = useMemo(
    () => ({ "line-color": zoneColor, "line-width": 1.5, "line-dasharray": [2, 2] }),
    [zoneColor],
  );
  const otherPaint = useMemo(
    () => ({ "line-color": muted, "line-width": 3, "line-opacity": 0.45 }),
    [muted],
  );

  return (
    <MapView dragRotate={false} touchPitch={false} center={start ?? center} zoom={start ? 10 : 9}>
      <FailBeforeLoad onFail={onFail} />
      <FitZone start={start} zoneRadiusKm={zoneRadiusKm} />
      <TapToMoveStart onStartChange={onStartChange} />
      <MapGeoJSON id="route-builder-zone" data={zone} fillPaint={zonePaint} linePaint={zoneLine} />
      <MapGeoJSON
        id="route-builder-others"
        data={others}
        fillPaint={false}
        linePaint={otherPaint}
      />
      <MapGeoJSON
        id="route-builder-casing"
        data={stretches}
        fillPaint={false}
        linePaint={CASING_PAINT}
      />
      <MapGeoJSON
        id="route-builder-route"
        data={stretches}
        fillPaint={false}
        linePaint={STRETCH_PAINT}
      />
      {start ? (
        <MapMarker
          longitude={start[0]}
          latitude={start[1]}
          draggable
          onDragEnd={({ lng, lat }) => onStartChange([lng, lat])}
        >
          <MarkerContent>
            {/* A 40px hit area, so a thumb can drag it. */}
            <span className="flex size-10 items-center justify-center">
              <span
                aria-label="Start and finish"
                className="bg-ds-gray-1000 block size-4 rounded-full border-[3px] border-white shadow"
              />
            </span>
          </MarkerContent>
        </MapMarker>
      ) : null}
      <MapLegend />
      <MapControls
        showZoom
        showLocate
        showFullscreen
        position="bottom-right"
        onLocate={({ longitude, latitude }) => onStartChange([longitude, latitude])}
      />
    </MapView>
  );
}

function MapLegend() {
  return (
    <div className="bg-background/90 pointer-events-none absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-[0.6875rem] shadow-sm">
      {(Object.keys(FIT_STYLE) as StretchFit[]).map((fit) => (
        <span key={fit} className="flex items-center gap-1">
          <span className={`block h-1 w-3 rounded-full ${FIT_STYLE[fit].swatch}`} />
          {FIT_STYLE[fit].label}
        </span>
      ))}
    </div>
  );
}
