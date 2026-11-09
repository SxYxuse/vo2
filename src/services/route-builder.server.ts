import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities } from "@/db/schema.ts";
import { BRouterError, brouterAvailable, routeThrough } from "@/integrations/brouter/client.ts";
import { StravaApi } from "@/integrations/strava/client.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { getStravaAccessToken } from "@/lib/strava-token.server.ts";
import { decodePolyline, type LngLat } from "./activity-map.types.ts";
import type {
  ProposedRoute,
  RideDiscipline,
  RouteBuilderStatus,
  RouteProposal,
  RouteRequest,
} from "./route-builder.types.ts";
import {
  destination,
  haversineM,
  overlapShare,
  scoreRoute,
  type PopularSegment,
} from "./route-scoring.ts";

const OUTDOOR_RIDES = ["Ride", "GravelRide", "MountainBikeRide", "EBikeRide"];

export async function loadRouteBuilderStatusImpl(): Promise<RouteBuilderStatus> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, available: brouterAvailable(), home: null };
  const [latest] = await db
    .select({ polyline: activities.summaryPolyline })
    .from(activities)
    .where(
      and(
        eq(activities.userId, session.user.id),
        inArray(activities.sportType, OUTDOOR_RIDES),
        isNotNull(activities.summaryPolyline),
      ),
    )
    .orderBy(desc(activities.startDate))
    .limit(1);
  const home = latest?.polyline ? (decodePolyline(latest.polyline)[0] ?? null) : null;
  return { signedIn: true, available: brouterAvailable(), home };
}

/** Real roads wind, so a loop through waypoints on a circle rides longer than the circle. */
const WINDING: Record<RideDiscipline, number> = { road: 1.25, gravel: 1.35 };
/** BRouter answers a 50 km loop in well under a second, so trying many is cheap. */
const CANDIDATES = 8;
const PROPOSALS = 3;

type LoopRequest = RouteRequest & { seed: number };

type LoopPlan = {
  bearing: number;
  clockwise: boolean;
  radius: number;
  /** Degrees each of the three waypoints is slid along the circle, to step off a bad way. */
  slides: [number, number, number];
};

type Attempt = { plan: LoopPlan; waypoints: Waypoint[]; route: ProposedRoute };

/** A fixed waypoint is the start or a popular segment's end, which repairs never move. */
type Waypoint = { at: LngLat; slot: number | null };

export async function proposeRoutesImpl(request: LoopRequest): Promise<RouteProposal> {
  const session = await getOptionalSession();
  if (!session) return { status: "signedOut" };
  if (!brouterAvailable()) return { status: "unavailable" };

  const targetM = request.distanceKm * 1000;
  const zoneRadiusM = request.zoneRadiusKm * 1000;
  const segments = await popularSegments(session.user.id, request.start, zoneRadiusM);
  const context = { request, targetM, zoneRadiusM, segments };

  const failures: string[] = [];
  const routes: ProposedRoute[] = [];
  const plans = Array.from({ length: CANDIDATES }, (_, index) => ({
    bearing: (request.seed * 37 + (index * 360) / CANDIDATES) % 360,
    clockwise: (index + request.seed) % 2 === 0,
  }));
  // BRouter runs four threads (docker/brouter); three loops at a time leave one for other athletes.
  for (let index = 0; index < plans.length; index += 3) {
    const batch = plans.slice(index, index + 3).map(async ({ bearing, clockwise }) => {
      try {
        return await bestLoop(context, bearing, clockwise);
      } catch (error) {
        if (!(error instanceof BRouterError)) throw error;
        failures.push(error.message);
        return null;
      }
    });
    for (const route of await Promise.all(batch)) if (route) routes.push(route);
  }

  if (!routes.length) {
    logger.warn("route_builder.no_route", { failures });
    return { status: "noRoute", message: explainFailure(failures[0]) };
  }

  const kept: ProposedRoute[] = [];
  for (const route of routes.sort((left, right) => rank(right) - rank(left))) {
    const line = lineOf(route);
    if (kept.some((other) => overlapShare(line, lineOf(other)) > 0.6)) continue;
    kept.push(route);
    if (kept.length === PROPOSALS) break;
  }
  logger.info("route_builder.proposed", {
    discipline: request.discipline,
    candidates: routes.length,
    confidence: kept.map((route) => route.confidence),
    popularity: segments !== null,
  });
  return { status: "ok", routes: kept, popularityAvailable: segments !== null };
}

/**
 * Confidence first. Busy roads can be ridden, so they don't lower confidence, but of two loops the
 * quieter one comes first. A gravel loop also needs gravel: one that is nearly all asphalt is
 * rideable but isn't what the athlete asked for, so it ranks below one at least 40 % unpaved.
 */
function rank(route: ProposedRoute) {
  const quiet = route.confidence - route.shares.busy * 20;
  if (route.discipline === "road") return quiet;
  return quiet * (0.75 + 0.25 * Math.min(1, route.shares.unpaved / 0.4));
}

function lineOf(route: ProposedRoute): LngLat[] {
  return route.coordinates.map(([lng, lat]) => [lng, lat]);
}

function explainFailure(reason: string | undefined) {
  if (reason === "BRouter is unreachable") {
    return "The route server isn't answering. Try again in a moment.";
  }
  if (reason && /not mapped|datafile|segment/i.test(reason)) {
    return "VO2 has no map data for this area yet. Pick a zone in a supported region.";
  }
  if (reason && /island/i.test(reason)) {
    return "The start is cut off from the road network. Move the start onto a road.";
  }
  return "No rideable loop was found here. Try a bigger zone or a shorter distance.";
}

type LoopContext = {
  request: LoopRequest;
  targetM: number;
  zoneRadiusM: number;
  segments: PopularSegment[] | null;
};

/**
 * One loop: waypoints on a circle that passes through the start and lies inside the zone. It is
 * resized once when it misses the distance by over 12 %, then repaired up to twice: BRouter
 * snaps a waypoint to the nearest way, so one dropped in a forest drags a road loop onto a path,
 * and sliding that waypoint along the circle usually lands it on a road.
 */
async function bestLoop(context: LoopContext, bearing: number, clockwise: boolean) {
  const { request, targetM, zoneRadiusM } = context;
  const maxRadius = (zoneRadiusM / 2) * 0.95;
  const plan: LoopPlan = {
    bearing,
    clockwise,
    radius: Math.min(maxRadius, targetM / (2 * Math.PI * WINDING[request.discipline])),
    slides: [0, 0, 0],
  };
  let best = await attempt(context, plan);

  const miss = best.route.distanceM / targetM;
  if (Math.abs(miss - 1) > 0.12 && (miss > 1 || plan.radius < maxRadius)) {
    const resized = await attempt(context, {
      ...plan,
      radius: Math.min(maxRadius, plan.radius / miss),
    }).catch(ignoreBRouter);
    if (resized && rank(resized.route) >= rank(best.route) - 5) best = resized;
  }

  for (const direction of [1, -1]) {
    const slides = slidesOffBadWays(best, direction);
    if (!slides) break;
    const repaired = await attempt(context, { ...best.plan, slides }).catch(ignoreBRouter);
    if (repaired && rank(repaired.route) > rank(best.route)) best = repaired;
  }
  return best.route;
}

function ignoreBRouter(error: unknown): null {
  if (error instanceof BRouterError) return null;
  throw error;
}

async function attempt(context: LoopContext, plan: LoopPlan): Promise<Attempt> {
  const { request, targetM, zoneRadiusM, segments } = context;
  const waypoints = loopWaypoints(request.start, plan, segments, zoneRadiusM);
  const leg = await routeThrough(
    request.discipline,
    waypoints.map((waypoint) => waypoint.at),
  );
  const route = scoreRoute(`${request.seed}-${Math.round(plan.bearing)}`, request.discipline, leg, {
    targetM,
    start: request.start,
    zoneRadiusM,
    segments,
  });
  return { plan, waypoints, route };
}

/** Slides each movable waypoint that sits by an unsuitable stretch 15° further along the circle. */
function slidesOffBadWays(best: Attempt, direction: number): LoopPlan["slides"] | null {
  const bad = best.route.stretches
    .filter((stretch) => stretch.fit === "unsuitable")
    .flatMap((stretch) => stretch.coordinates);
  if (!bad.length) return null;
  const slides = [...best.plan.slides] as LoopPlan["slides"];
  let moved = false;
  for (const waypoint of best.waypoints) {
    if (waypoint.slot === null) continue;
    if (bad.some((point) => haversineM(point, waypoint.at) < 400)) {
      slides[waypoint.slot] += direction * 15;
      moved = true;
    }
  }
  return moved ? slides : null;
}

function loopWaypoints(
  start: LngLat,
  plan: LoopPlan,
  segments: PopularSegment[] | null,
  zoneRadiusM: number,
): Waypoint[] {
  const centre = destination(start, plan.bearing, plan.radius);
  const back = (plan.bearing + 180) % 360;
  const turn = plan.clockwise ? 1 : -1;
  const used = new Set<number>();
  const points: Waypoint[] = [{ at: start, slot: null }];
  for (const slot of [0, 1, 2]) {
    const angle = back + turn * ((slot + 1) * 90 + plan.slides[slot]!);
    const waypoint = destination(centre, angle, plan.radius);
    // Riding a popular segment end to end is the best evidence a stretch is ridden, so a waypoint
    // moves onto one that starts nearby and stays inside the zone.
    const segment = segments?.find(
      (candidate) =>
        !used.has(candidate.id) &&
        haversineM(candidate.points[0]!, waypoint) < plan.radius * 0.35 &&
        candidate.points.every((point) => haversineM(point, start) < zoneRadiusM),
    );
    if (segment) {
      used.add(segment.id);
      points.push(
        { at: segment.points[0]!, slot: null },
        { at: segment.points.at(-1)!, slot: null },
      );
    } else {
      points.push({ at: waypoint, slot });
    }
  }
  points.push({ at: start, slot: null });
  return points;
}

/**
 * Popular ride segments in the zone, from four quadrant searches because each returns only ten.
 * Null when Strava refuses: confidence then rests on OSM tags alone, and the page says so.
 */
async function popularSegments(
  userId: string,
  start: LngLat,
  zoneRadiusM: number,
): Promise<PopularSegment[] | null> {
  const north = destination(start, 0, zoneRadiusM)[1];
  const south = destination(start, 180, zoneRadiusM)[1];
  const east = destination(start, 90, zoneRadiusM)[0];
  const west = destination(start, 270, zoneRadiusM)[0];
  const [lng, lat] = start;
  const quadrants: Array<[number, number, number, number]> = [
    [south, west, lat, lng],
    [south, lng, lat, east],
    [lat, west, north, lng],
    [lat, lng, north, east],
  ];
  try {
    const api = new StravaApi(await getStravaAccessToken(userId));
    const responses = await Promise.all(quadrants.map((bounds) => api.exploreSegments(bounds)));
    const byId = new Map<number, PopularSegment>();
    for (const segment of responses.flatMap((response) => response.segments ?? [])) {
      if (!segment.id || !segment.points) continue;
      const points = decodePolyline(segment.points);
      if (points.length < 2) continue;
      byId.set(segment.id, { id: segment.id, name: segment.name ?? "Segment", points });
    }
    return [...byId.values()].filter((segment) =>
      segment.points.some((point) => haversineM(point, start) < zoneRadiusM),
    );
  } catch (error) {
    logger.warn("route_builder.segments_unavailable", errorFields(error));
    return null;
  }
}
