"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { LineLayerSpecification } from "maplibre-gl";
import { ArrowRightLeftIcon } from "lucide-react";

import { boundsOf, type LngLat } from "@/services/activity-map.types.ts";
import {
  legPassing,
  type GpxPoint,
  type Junction,
  type MergedRoute,
} from "@/services/gpx-merge.ts";
import type { GpxMergeTrack } from "@/lib/gpx-merge-draft.ts";
import { Button } from "@/components/ui/button";
import {
  Map as MapView,
  MapControls,
  MapGeoJSON,
  MapMarker,
  MapPopup,
  MarkerContent,
  useMap,
} from "@/components/ui/map";

import { FailBeforeLoad } from "./map-fail-before-load.tsx";
import { resolveThemeColor } from "./map-theme-color.ts";

export type GpxMergeMapViewProps = {
  tracks: GpxMergeTrack[];
  route: MergedRoute;
  junctions: Junction[];
  onSwitch: (junction: Junction) => void;
  onFail: () => void;
};

const lngLat = (point: GpxPoint): LngLat => [point.lng, point.lat];

function km(m: number) {
  return `km ${(m / 1000).toFixed(1)}`;
}

/** Frames every file when the set of files changes, but never while legs are being edited. */
function FitTracks({ tracks }: { tracks: GpxMergeTrack[] }) {
  const { map, isLoaded } = useMap();
  const key = tracks.map((track) => track.id).join(",");
  const latest = useRef(tracks);
  latest.current = tracks;

  useEffect(() => {
    if (!isLoaded || !map) return;
    const viewport = boundsOf(latest.current.flatMap((track) => track.points.map(lngLat)));
    if (!viewport) return;
    if (viewport.bounds) map.fitBounds(viewport.bounds, { padding: 40, maxZoom: 15, duration: 0 });
    else map.jumpTo({ center: viewport.center, zoom: viewport.zoom });
  }, [isLoaded, key, map]);

  return null;
}

// Static paints, so a slider tick that redraws the route doesn't reapply them.
const SOURCE_PAINT: LineLayerSpecification["paint"] = {
  "line-color": ["get", "color"],
  "line-width": 3,
  "line-opacity": 0.35,
};
const CASING_PAINT: LineLayerSpecification["paint"] = {
  "line-color": "#ffffff",
  "line-width": 8,
  "line-opacity": 0.9,
};
const ROUTE_PAINT: LineLayerSpecification["paint"] = {
  "line-color": ["get", "color"],
  "line-width": 4.5,
  "line-opacity": 1,
};

function useResolvedColors(tokens: string[]) {
  const key = tokens.join("|");
  return useMemo(() => {
    const resolved = new Map<string, string>();
    for (const token of key.split("|")) {
      if (token && !resolved.has(token)) resolved.set(token, resolveThemeColor(token));
    }
    return resolved;
  }, [key]);
}

export function GpxMergeMapView({
  tracks,
  route,
  junctions,
  onSwitch,
  onFail,
}: GpxMergeMapViewProps) {
  const [selected, setSelected] = useState<Junction | null>(null);
  const colors = useResolvedColors(tracks.map((track) => track.color));
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const colorOf = (trackId: string) => colors.get(trackById.get(trackId)?.color ?? "") ?? "#888";

  const sources = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: tracks.map((track) => ({
        type: "Feature",
        properties: { color: colors.get(track.color) ?? "#888" },
        geometry: { type: "LineString", coordinates: track.points.map(lngLat) },
      })),
    }),
    [colors, tracks],
  );

  const legs = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: route.legs
        .filter((leg) => leg.points.length >= 2)
        .map((leg) => ({
          type: "Feature",
          properties: {
            color: colors.get(trackById.get(leg.trackId)?.color ?? "") ?? "#888",
          },
          geometry: { type: "LineString", coordinates: leg.points.map(lngLat) },
        })),
    }),
    [colors, route, trackById],
  );

  const gaps = useMemo<FeatureCollection<LineString>>(() => {
    const features: FeatureCollection<LineString>["features"] = [];
    route.legs.forEach((leg, index) => {
      const previous = route.legs[index - 1]?.points.at(-1);
      const start = leg.points[0];
      if (!previous || !start || leg.gapM < 1) return;
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [lngLat(previous), lngLat(start)] },
      });
    });
    return { type: "FeatureCollection", features };
  }, [route]);

  const finish = route.points.at(-1);
  // Which file a tap on the selected meeting point leaves, and which it joins.
  const passing = selected ? route.legs[legPassing(route, selected)] : undefined;
  const leaving =
    passing && selected
      ? [selected.a, selected.b].find((side) => side.trackId === passing.trackId)
      : undefined;
  const joining =
    leaving && selected ? (leaving === selected.a ? selected.b : selected.a) : undefined;
  const gapPaint = useMemo(
    () => ({
      "line-color": resolveThemeColor("var(--color-ds-red-700)"),
      "line-width": 3,
      "line-dasharray": [1.5, 1.5],
    }),
    [],
  );

  return (
    <MapView dragRotate={false} touchPitch={false} center={[4, 50]} zoom={9}>
      <FailBeforeLoad onFail={onFail} />
      <FitTracks tracks={tracks} />
      <MapGeoJSON
        id="gpx-merge-sources"
        data={sources}
        fillPaint={false}
        linePaint={SOURCE_PAINT}
      />
      <MapGeoJSON id="gpx-merge-casing" data={legs} fillPaint={false} linePaint={CASING_PAINT} />
      <MapGeoJSON id="gpx-merge-route" data={legs} fillPaint={false} linePaint={ROUTE_PAINT} />
      <MapGeoJSON id="gpx-merge-gaps" data={gaps} fillPaint={false} linePaint={gapPaint} />
      {junctions.map((junction) => (
        <MapMarker
          key={junction.id}
          longitude={junction.at[0]}
          latitude={junction.at[1]}
          onClick={(event) => {
            // The map's own click would close the popup this opens.
            event.stopPropagation();
            setSelected(junction);
          }}
        >
          <MarkerContent>
            {/* A 32px hit area around a small ring, so a thumb can pick it. */}
            <span className="flex size-8 items-center justify-center">
              <span
                aria-label="Meeting point"
                className="bg-background block size-3.5 rounded-full border-[3px] border-ds-gray-1000 shadow"
              />
            </span>
          </MarkerContent>
        </MapMarker>
      ))}
      {route.legs.map((leg, index) => {
        const start = leg.points[0];
        if (!start) return null;
        return (
          <MapMarker key={leg.id} longitude={start.lng} latitude={start.lat}>
            <MarkerContent>
              <span
                aria-label={`Leg ${index + 1} start`}
                className="flex size-5 items-center justify-center rounded-full border-2 border-white text-[0.625rem] font-semibold text-white shadow"
                style={{ backgroundColor: colorOf(leg.trackId) }}
              >
                {index + 1}
              </span>
            </MarkerContent>
          </MapMarker>
        );
      })}
      {finish ? (
        <MapMarker longitude={finish.lng} latitude={finish.lat}>
          <MarkerContent>
            <span
              aria-label="Finish"
              className="bg-ds-gray-1000 block size-3.5 rounded-full border-2 border-white shadow"
            />
          </MarkerContent>
        </MapMarker>
      ) : null}
      {selected ? (
        <MapPopup
          key={selected.id}
          longitude={selected.at[0]}
          latitude={selected.at[1]}
          onClose={() => setSelected(null)}
          closeButton
        >
          <div className="flex flex-col gap-2 pr-4 text-xs">
            <p className="font-medium">
              {selected.kind === "cross"
                ? "Crossing"
                : selected.kind === "join"
                  ? "Routes join"
                  : "Routes split"}
            </p>
            {[selected.a, selected.b].map((side) => (
              <p key={side.trackId} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorOf(side.trackId) }}
                />
                <span className="truncate">{trackById.get(side.trackId)?.name}</span>
                <span className="text-muted-foreground ml-auto tabular-nums">{km(side.m)}</span>
              </p>
            ))}
            {joining ? (
              <Button
                size="sm"
                onClick={() => {
                  onSwitch(selected);
                  setSelected(null);
                }}
              >
                <ArrowRightLeftIcon />
                <span className="truncate">Switch to {trackById.get(joining.trackId)?.name}</span>
              </Button>
            ) : (
              <p className="text-muted-foreground">Your route doesn't pass here.</p>
            )}
          </div>
        </MapPopup>
      ) : null}
      <MapLegend jumps={gaps.features.length > 0} />
      <MapControls showZoom showFullscreen position="bottom-right" />
    </MapView>
  );
}

/** What the markers mean, since the map is where meeting points are picked. */
function MapLegend({ jumps }: { jumps: boolean }) {
  return (
    <div className="bg-background/90 pointer-events-none absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-[0.6875rem] shadow-sm">
      <span className="flex items-center gap-1">
        <span className="bg-background block size-2.5 rounded-full border-2 border-ds-gray-1000" />
        Meeting point, tap to switch
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-ds-gray-700 flex size-3.5 items-center justify-center rounded-full text-[0.5rem] font-semibold text-white">
          1
        </span>
        Start, then each switch
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-ds-gray-1000 block size-2.5 rounded-full" />
        Finish
      </span>
      {jumps ? (
        <span className="flex items-center gap-1">
          <span className="border-ds-red-700 block w-3 border-t-2 border-dashed" />
          Straight jump
        </span>
      ) : null}
    </div>
  );
}
