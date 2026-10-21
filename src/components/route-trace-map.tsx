"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FeatureCollection, LineString } from "geojson";

import { boundsOf, type LngLat } from "@/services/activity-map.types.ts";
import { pointAtKm, traceSegments, type ProfilePoint } from "@/services/route-plan.ts";
import type { RouteClimb } from "@/services/route-prediction.ts";
import {
  Map as MapView,
  MapControls,
  MapGeoJSON,
  MapMarker,
  MarkerContent,
  useMap,
} from "@/components/ui/map";

type RouteTraceMapViewProps = {
  points: ProfilePoint[];
  climbs: RouteClimb[];
  hoverKm: number | null;
  activeClimbStart: number | null;
  onHoverKm: (km: number | null) => void;
  onSelectClimb: (startSec: number | null) => void;
};

function resolveThemeColor(token: string) {
  const probe = document.createElement("span");
  probe.style.color = token;
  document.body.append(probe);
  const cssColor = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return cssColor || token;
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 255) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

function FitRoute({ bounds }: { bounds: [LngLat, LngLat] }) {
  const { map, isLoaded } = useMap();
  const boundsKey = bounds.flat().join(",");
  const camera = useRef(bounds);
  camera.current = bounds;

  useEffect(() => {
    if (!isLoaded || !map) return;
    map.fitBounds(camera.current, { padding: 28, maxZoom: 13, duration: 0 });
  }, [boundsKey, isLoaded, map]);

  return null;
}

export function RouteTraceMapView({
  points,
  climbs,
  hoverKm,
  activeClimbStart,
  onHoverKm,
  onSelectClimb,
}: RouteTraceMapViewProps) {
  const viewport = useMemo(
    () => boundsOf(points.map((point) => [point.lon, point.lat] as LngLat)),
    [points],
  );
  const hover = hoverKm == null ? null : pointAtKm(points, hoverKm);

  const geojson = useMemo<FeatureCollection<LineString>>(() => {
    const rest = resolveThemeColor("var(--color-ds-blue-700)");
    const climb = resolveThemeColor("var(--color-ds-amber-700)");
    return {
      type: "FeatureCollection",
      features: traceSegments(points, climbs).map((segment, index) => {
        const onSelected = activeClimbStart != null && segment.startSec === activeClimbStart;
        return {
          type: "Feature",
          id: index,
          properties: {
            color: segment.climb ? climb : rest,
            climb: segment.climb,
            startSec: segment.startSec,
            width: onSelected ? 5 : segment.climb ? 4 : 3,
          },
          geometry: { type: "LineString", coordinates: segment.coordinates },
        };
      }),
    };
  }, [activeClimbStart, climbs, points]);

  if (!viewport) return null;

  return (
    <MapView
      className="rounded-xl"
      center={viewport.center}
      zoom={viewport.zoom}
      scrollZoom={false}
      dragRotate={false}
      touchPitch={false}
    >
      {viewport.bounds ? <FitRoute bounds={viewport.bounds} /> : null}
      <MapGeoJSON
        data={geojson}
        fillPaint={false}
        interactive
        linePaint={{
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.95,
        }}
        onHover={(event) => {
          if (!event) {
            onHoverKm(null);
            return;
          }
          const { longitude, latitude } = event;
          let nearest = points[0];
          let best = Infinity;
          for (const point of points) {
            const delta = (point.lon - longitude) ** 2 + (point.lat - latitude) ** 2;
            if (delta < best) {
              best = delta;
              nearest = point;
            }
          }
          onHoverKm(nearest?.km ?? null);
        }}
        onClick={(event) => {
          const startSec = event.feature.properties?.startSec;
          onSelectClimb(typeof startSec === "number" ? startSec : null);
        }}
      />
      {[
        { point: points.find((point) => Number.isFinite(point.lat)), label: "Start" },
        { point: points.filter((point) => Number.isFinite(point.lat)).at(-1), label: "Finish" },
      ].map(({ point, label }) =>
        point ? (
          <MapMarker key={label} longitude={point.lon} latitude={point.lat}>
            <MarkerContent>
              <span
                aria-label={label}
                className={`block size-3 rounded-full border-2 border-white shadow ${
                  label === "Start" ? "bg-ds-green-700" : "bg-ds-gray-1000"
                }`}
              />
            </MarkerContent>
          </MapMarker>
        ) : null,
      )}
      {hover ? (
        <MapMarker longitude={hover.lon} latitude={hover.lat}>
          <MarkerContent>
            <span className="bg-ds-blue-700 block size-2.5 rounded-full border-2 border-white shadow" />
          </MarkerContent>
        </MapMarker>
      ) : null}
      <MapControls showZoom position="bottom-right" />
    </MapView>
  );
}
