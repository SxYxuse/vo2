"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";

import { formatSportType, sportTypeColor } from "@/services/athlete-settings.types.ts";
import {
  ALL_SPORTS,
  focusBoundsOf,
  decodePolyline,
  mapSportOptions,
  type LngLat,
} from "@/services/activity-map.types.ts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Map as MapView, MapControls, MapGeoJSON, useMap } from "@/components/ui/map";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { resolveThemeColor } from "./map-theme-color.ts";

import type { ActivityMapProps } from "./activity-map.tsx";

type DecoratedTrack = ActivityMapProps["tracks"][number] & { coordinates: LngLat[] };

function FitTracks({
  bounds,
  center,
  zoom,
}: {
  bounds: [LngLat, LngLat] | null;
  center: LngLat;
  zoom: number;
}) {
  const { map, isLoaded } = useMap();
  const boundsKey = bounds ? bounds.flat().join(",") : `${center.join(",")}:${zoom}`;
  const camera = useRef({ bounds, center, zoom });
  camera.current = { bounds, center, zoom };

  useEffect(() => {
    if (!isLoaded || !map) return;
    const next = camera.current;
    if (next.bounds) {
      map.fitBounds(next.bounds, { padding: 56, maxZoom: 14, duration: 400 });
      return;
    }
    map.jumpTo({ center: next.center, zoom: next.zoom });
  }, [boundsKey, isLoaded, map]);

  return null;
}

export function ActivityMapView({ tracks, sportTypes, sportGroupShares }: ActivityMapProps) {
  const [sportType, setSportType] = useState(ALL_SPORTS);

  const decoded = useMemo<DecoratedTrack[]>(
    () =>
      tracks.flatMap((track) => {
        const coordinates = decodePolyline(track.polyline);
        if (coordinates.length < 2) return [];
        return [{ ...track, coordinates }];
      }),
    [tracks],
  );

  const sports = useMemo(
    () =>
      mapSportOptions(
        decoded.map((track) => track.sportType),
        sportGroupShares,
      ),
    [decoded, sportGroupShares],
  );

  const selectedType = sports.some((sport) => sport.sportType === sportType)
    ? sportType
    : ALL_SPORTS;
  const selectedMembers =
    selectedType === ALL_SPORTS
      ? null
      : (sports.find((sport) => sport.sportType === selectedType)?.members ?? [selectedType]);

  const visibleTracks = useMemo(
    () => decoded.filter((track) => !selectedMembers || selectedMembers.includes(track.sportType)),
    [decoded, selectedMembers],
  );

  const viewport = useMemo(() => focusBoundsOf(visibleTracks), [visibleTracks]);

  const geojson = useMemo<FeatureCollection<LineString | MultiLineString>>(() => {
    const colors = new Map<string, string>();
    const colorOf = (token: string) => {
      const cached = colors.get(token);
      if (cached) return cached;
      const resolved = resolveThemeColor(token);
      colors.set(token, resolved);
      return resolved;
    };
    const byColor = new Map<string, LngLat[][]>();
    for (const track of visibleTracks) {
      const color = colorOf(sportTypeColor(sportTypes, track.sportType));
      let lines = byColor.get(color);
      if (!lines) {
        lines = [];
        byColor.set(color, lines);
      }
      lines.push(track.coordinates);
    }
    return {
      type: "FeatureCollection",
      features: [...byColor.entries()].map(([color, lines], index) => ({
        type: "Feature",
        id: index,
        properties: { color },
        geometry: { type: "MultiLineString", coordinates: lines },
      })),
    };
  }, [sportTypes, visibleTracks]);

  if (!decoded.length) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>No GPS tracks yet</EmptyTitle>
          <EmptyDescription>
            Sync outdoor activities from Strava that include a map. Indoor sessions without a GPS
            path stay off this view.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!sports.length) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>No activity types enabled</EmptyTitle>
          <EmptyDescription>
            Turn on at least one activity type in settings to plot passages.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3">
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          value={[selectedType]}
          onValueChange={(next) => {
            const value = next[0];
            if (value) startTransition(() => setSportType(value));
          }}
          className="flex-wrap"
        >
          <ToggleGroupItem value={ALL_SPORTS}>All</ToggleGroupItem>
          {sports.map((sport) => (
            <ToggleGroupItem key={sport.sportType} value={sport.sportType}>
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  backgroundColor: sportTypes[sport.sportType]?.color ?? "var(--color-ds-gray-700)",
                }}
              />
              {formatSportType(sport.sportType)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground text-xs">
          {visibleTracks.length} mapped {visibleTracks.length === 1 ? "activity" : "activities"}
          {selectedType === ALL_SPORTS ? null : (
            <>
              {" "}
              · <Badge variant="outline">{formatSportType(selectedType)}</Badge>
            </>
          )}
        </p>
      </div>
      <Card className="min-h-80 flex-1 overflow-hidden py-0">
        <CardContent className="h-full min-h-80 p-0">
          <div className="h-full min-h-80 w-full">
            {visibleTracks.length && viewport ? (
              <MapView center={viewport.center} zoom={viewport.zoom}>
                <FitTracks bounds={viewport.bounds} center={viewport.center} zoom={viewport.zoom} />
                <MapGeoJSON
                  data={geojson}
                  fillPaint={false}
                  linePaint={{
                    "line-color": ["get", "color"],
                    "line-width": 2.5,
                    "line-opacity": 0.55,
                  }}
                />
                <MapControls showZoom showFullscreen />
              </MapView>
            ) : (
              <Empty className="h-full min-h-64 border-0">
                <EmptyHeader>
                  <EmptyTitle>Nothing to plot for this type</EmptyTitle>
                  <EmptyDescription>
                    Choose All or another sport that has GPS tracks.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
