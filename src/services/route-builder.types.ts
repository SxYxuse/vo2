import type { LngLat } from "./activity-map.types.ts";

export const RIDE_DISCIPLINES = ["road", "gravel"] as const;

export type RideDiscipline = (typeof RIDE_DISCIPLINES)[number];

/** What the athlete asks for: a loop from the zone's centre that stays inside it. */
export type RouteRequest = {
  discipline: RideDiscipline;
  start: LngLat;
  zoneRadiusKm: number;
  distanceKm: number;
};

export const ZONE_RADIUS_KM = { min: 3, max: 40, default: 12 } as const;
export const ROUTE_DISTANCE_KM = { min: 10, max: 160, default: 50 } as const;

/**
 * How well one stretch suits the discipline, read from its OpenStreetMap tags. `likely` is a
 * road whose surface nobody tagged but whose kind is paved almost everywhere VO2 is used.
 */
export type StretchFit = "good" | "likely" | "uncertain" | "unsuitable";

export type RouteStretch = {
  fit: StretchFit;
  /** Why, in a few words, such as "gravel track" or "untagged surface". */
  reason: string;
  coordinates: LngLat[];
};

/** A loop as BRouter routed it, before VO2 scores it. */
export type RoutedLeg = {
  /** [lng, lat, ele] along the whole route. */
  coordinates: Array<[number, number, number | null]>;
  /** One entry per stretch with the same OSM tags, ending at `endIndex` in `coordinates`. */
  stretches: Array<{ endIndex: number; distanceM: number; tags: Record<string, string> }>;
  distanceM: number;
  climbM: number;
};

export type RouteIssue = {
  kind: "unsuitable" | "uncertain" | "busy" | "retrace" | "zone";
  text: string;
};

export type ProposedRoute = {
  id: string;
  discipline: RideDiscipline;
  coordinates: Array<[lng: number, lat: number, ele: number | null]>;
  stretches: RouteStretch[];
  distanceM: number;
  climbM: number;
  /** 0 to 100: how sure VO2 is the whole loop can be ridden on this bike (ADR 0062). */
  confidence: number;
  /** Shares of the distance, 0 to 1. */
  shares: {
    good: number;
    likely: number;
    uncertain: number;
    unsuitable: number;
    unpaved: number;
    popular: number;
    retraced: number;
    busy: number;
  };
  /** Popular Strava segments the loop rides most of. */
  segments: string[];
  issues: RouteIssue[];
};

export type RouteProposal =
  | {
      status: "ok";
      routes: ProposedRoute[];
      /** False when Strava refused the segment explorer, so confidence rests on OSM alone. */
      popularityAvailable: boolean;
    }
  | { status: "unavailable" | "signedOut" }
  | { status: "noRoute"; message: string };

export type RouteBuilderStatus = {
  signedIn: boolean;
  available: boolean;
  /** Where the athlete's latest outdoor ride started, to centre the first zone. */
  home: LngLat | null;
};

export function confidenceLabel(confidence: number) {
  if (confidence >= 80) return "High";
  if (confidence >= 60) return "Medium";
  return "Low";
}
