import type { LngLat } from "./activity-map.types.ts";
import type {
  ProposedRoute,
  RideDiscipline,
  RouteIssue,
  RoutedLeg,
  RouteStretch,
  StretchFit,
} from "./route-builder.types.ts";

/*
 * Route confidence (ADR 0062): how sure VO2 is a loop can be ridden end to end on the chosen bike.
 * It starts from the OpenStreetMap tags of every stretch, loses points for riding the same road
 * twice, leaving the zone, or missing the asked distance, and gains a little for stretches on
 * popular Strava segments, the one popularity signal Strava's API offers.
 */

const PAVED = new Set(["asphalt", "concrete", "paved", "concrete:plates", "concrete:lanes"]);
const ROUGH_PAVED = new Set(["paving_stones", "sett", "cobblestone", "unhewn_cobblestone"]);
const GRAVEL = new Set(["compacted", "fine_gravel", "gravel", "unpaved", "pebblestone"]);
const SOFT = new Set(["dirt", "ground", "earth", "grass_paver", "woodchips"]);
const LOOSE = new Set(["sand", "mud", "grass", "rock", "stone"]);
const BAD_SMOOTHNESS = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);
/** Road kinds that are paved nearly everywhere in Europe even when nobody tagged the surface. */
const USUALLY_PAVED = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "cycleway",
  "road",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
]);
const BUSY = new Set(["trunk", "primary", "trunk_link", "primary_link"]);

const FIT_WEIGHT: Record<StretchFit, number> = {
  good: 1,
  likely: 0.85,
  uncertain: 0.45,
  unsuitable: 0,
};

export function isUnpaved(tags: Record<string, string>) {
  const surface = tags.surface;
  if (surface) return GRAVEL.has(surface) || SOFT.has(surface) || LOOSE.has(surface);
  return tags.highway === "track" || tags.highway === "path" || tags.highway === "bridleway";
}

export function classifyStretch(
  discipline: RideDiscipline,
  tags: Record<string, string>,
): { fit: StretchFit; reason: string; busy: boolean } {
  const highway = tags.highway ?? "";
  const surface = tags.surface;
  const busy = BUSY.has(highway);
  if (highway === "steps") return { fit: "unsuitable", reason: "steps", busy };
  if (highway === "elevator") return { fit: "unsuitable", reason: "lift", busy };
  if (tags.bicycle === "no" || tags.bicycle === "dismount") {
    return { fit: "unsuitable", reason: "no bikes allowed", busy };
  }
  // Footways often forbid bikes without saying so, and are slow even where riding is allowed.
  if (
    (highway === "footway" || highway === "pedestrian") &&
    tags.bicycle !== "yes" &&
    tags.bicycle !== "designated"
  ) {
    return { fit: "uncertain" as const, reason: "footway, bikes may not be allowed", busy };
  }
  if (tags.smoothness && BAD_SMOOTHNESS.has(tags.smoothness)) {
    const worst = tags.smoothness !== "bad" || discipline === "road";
    return { fit: worst ? "unsuitable" : "uncertain", reason: `${tags.smoothness} surface`, busy };
  }
  return discipline === "road"
    ? classifyRoad(highway, surface, tags, busy)
    : classifyGravel(highway, surface, tags, busy);
}

function classifyRoad(
  highway: string,
  surface: string | undefined,
  tags: Record<string, string>,
  busy: boolean,
) {
  if (surface && PAVED.has(surface)) return { fit: "good" as const, reason: "paved", busy };
  if (surface && ROUGH_PAVED.has(surface)) {
    return { fit: "uncertain" as const, reason: surface.replaceAll("_", " "), busy };
  }
  if (surface) return { fit: "unsuitable" as const, reason: `${surface} surface`, busy };
  if (tags.tracktype === "grade1") return { fit: "likely" as const, reason: "paved track", busy };
  if (highway === "track" || highway === "path" || highway === "bridleway") {
    return { fit: "unsuitable" as const, reason: `${highway}, likely unpaved`, busy };
  }
  if (USUALLY_PAVED.has(highway)) {
    return { fit: "likely" as const, reason: "untagged surface", busy };
  }
  return {
    fit: "uncertain" as const,
    reason: highway ? `untagged ${highway}` : "unknown way",
    busy,
  };
}

function classifyGravel(
  highway: string,
  surface: string | undefined,
  tags: Record<string, string>,
  busy: boolean,
) {
  const grade = tags.tracktype;
  if (grade === "grade5") return { fit: "unsuitable" as const, reason: "grade 5 track", busy };
  if (surface && LOOSE.has(surface)) {
    return { fit: "unsuitable" as const, reason: `${surface} surface`, busy };
  }
  if (surface && (PAVED.has(surface) || GRAVEL.has(surface))) {
    return {
      fit: "good" as const,
      reason: GRAVEL.has(surface) ? surface.replaceAll("_", " ") : "paved",
      busy,
    };
  }
  if (surface && SOFT.has(surface)) {
    return { fit: "likely" as const, reason: `${surface}, muddy when wet`, busy };
  }
  if (surface && ROUGH_PAVED.has(surface)) {
    return { fit: "likely" as const, reason: surface.replaceAll("_", " "), busy };
  }
  if (grade === "grade1" || grade === "grade2" || grade === "grade3") {
    return { fit: "good" as const, reason: `${grade.replace("grade", "grade ")} track`, busy };
  }
  if (grade === "grade4") return { fit: "uncertain" as const, reason: "grade 4 track", busy };
  if (USUALLY_PAVED.has(highway)) return { fit: "good" as const, reason: "road", busy };
  if (highway === "track") return { fit: "uncertain" as const, reason: "untagged track", busy };
  if (highway === "path" || highway === "bridleway" || highway === "footway") {
    return { fit: "uncertain" as const, reason: `untagged ${highway}`, busy };
  }
  return {
    fit: "uncertain" as const,
    reason: highway ? `untagged ${highway}` : "unknown way",
    busy,
  };
}

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export function haversineM(from: LngLat, to: LngLat) {
  const dLat = (to[1] - from[1]) * RAD;
  const dLng = (to[0] - from[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from[1] * RAD) * Math.cos(to[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A point `distanceM` from `from` towards `bearing` (degrees clockwise from north). */
export function destination(from: LngLat, bearing: number, distanceM: number): LngLat {
  const angle = distanceM / EARTH_RADIUS_M;
  const theta = bearing * RAD;
  const lat1 = from[1] * RAD;
  const lng1 = from[0] * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angle) + Math.cos(lat1) * Math.sin(angle) * Math.cos(theta),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angle) * Math.cos(lat1),
      Math.cos(angle) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [lng2 / RAD, lat2 / RAD];
}

/** Grid cells about `cellM` wide, so nearby points share a key without pairwise distances. */
function cellOf(point: LngLat, cellM: number) {
  const latStep = cellM / 111_320;
  const lngStep = latStep / Math.max(0.2, Math.cos(point[1] * RAD));
  return [Math.floor(point[0] / lngStep), Math.floor(point[1] / latStep)] as const;
}

function cellKey(point: LngLat, cellM: number) {
  const [x, y] = cellOf(point, cellM);
  return `${x}:${y}`;
}

/** The cell and its eight neighbours, so a point near a cell edge still meets its neighbour. */
function cellKeysAround(point: LngLat, cellM: number) {
  const [x, y] = cellOf(point, cellM);
  const keys: string[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) keys.push(`${x + dx}:${y + dy}`);
  }
  return keys;
}

/** Points every ~`stepM` along a line, so shares are measured by distance, not by vertex. */
function samples(coordinates: LngLat[], stepM: number) {
  const out: Array<{ point: LngLat; atM: number; lengthM: number }> = [];
  let atM = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1]!;
    const to = coordinates[index]!;
    const length = haversineM(from, to);
    const pieces = Math.max(1, Math.ceil(length / stepM));
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = (piece + 0.5) / pieces;
      out.push({
        point: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
        atM: atM + length * t,
        lengthM: length / pieces,
      });
    }
    atM += length;
  }
  return out;
}

/**
 * Share of the loop ridden over road it already covered more than a kilometre earlier: the out
 * and back spurs a waypoint on a dead end produces.
 */
export function retracedShare(coordinates: LngLat[]) {
  const seen = new Map<string, number>();
  let total = 0;
  let retraced = 0;
  for (const sample of samples(coordinates, 15)) {
    total += sample.lengthM;
    const firstAt = seen.get(cellKey(sample.point, 15));
    if (firstAt !== undefined && sample.atM - firstAt > 1000) retraced += sample.lengthM;
    for (const key of cellKeysAround(sample.point, 15)) {
      if (!seen.has(key)) seen.set(key, sample.atM);
    }
  }
  return total > 0 ? retraced / total : 0;
}

export type PopularSegment = { id: number; name: string; points: LngLat[] };

/** Share of the loop within 20 to 40 m of a popular segment, and the segments it rides most of. */
export function popularOverlap(coordinates: LngLat[], segments: PopularSegment[]) {
  if (!segments.length) return { share: 0, names: [] as string[] };
  const owners = new Map<string, Set<number>>();
  for (const segment of segments) {
    for (const sample of samples(segment.points, 15)) {
      for (const key of cellKeysAround(sample.point, 20)) {
        const set = owners.get(key) ?? new Set<number>();
        set.add(segment.id);
        owners.set(key, set);
      }
    }
  }
  let total = 0;
  let popular = 0;
  const ridden = new Map<number, number>();
  for (const sample of samples(coordinates, 20)) {
    total += sample.lengthM;
    const ids = owners.get(cellKey(sample.point, 20));
    if (!ids) continue;
    popular += sample.lengthM;
    for (const id of ids) ridden.set(id, (ridden.get(id) ?? 0) + sample.lengthM);
  }
  const names = segments
    .filter((segment) => {
      const length = samples(segment.points, 20).reduce((sum, s) => sum + s.lengthM, 0);
      return length > 0 && (ridden.get(segment.id) ?? 0) / length >= 0.6;
    })
    .map((segment) => segment.name);
  return { share: total > 0 ? popular / total : 0, names };
}

function formatKm(m: number) {
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function scoreRoute(
  id: string,
  discipline: RideDiscipline,
  leg: RoutedLeg,
  context: {
    targetM: number;
    start: LngLat;
    zoneRadiusM: number;
    segments: PopularSegment[] | null;
  },
): ProposedRoute {
  const line: LngLat[] = leg.coordinates.map(([lng, lat]) => [lng, lat]);
  const byFit: Record<StretchFit, number> = { good: 0, likely: 0, uncertain: 0, unsuitable: 0 };
  const reasons = new Map<string, { fit: StretchFit; m: number }>();
  let busyM = 0;
  let unpavedM = 0;
  let measured = 0;
  const stretches: RouteStretch[] = [];
  let startIndex = 0;
  for (const stretch of leg.stretches) {
    const { fit, reason, busy } = classifyStretch(discipline, stretch.tags);
    byFit[fit] += stretch.distanceM;
    measured += stretch.distanceM;
    if (busy) busyM += stretch.distanceM;
    if (isUnpaved(stretch.tags)) unpavedM += stretch.distanceM;
    if (fit === "unsuitable" || fit === "uncertain") {
      const entry = reasons.get(reason) ?? { fit, m: 0 };
      entry.m += stretch.distanceM;
      reasons.set(reason, entry);
    }
    const coordinates = line.slice(startIndex, stretch.endIndex + 1);
    const previous = stretches.at(-1);
    if (previous && previous.fit === fit && previous.reason === reason) {
      previous.coordinates.push(...coordinates.slice(1));
    } else if (coordinates.length >= 2) {
      stretches.push({ fit, reason, coordinates });
    }
    startIndex = stretch.endIndex;
  }
  const total = measured || leg.distanceM || 1;
  const share = (m: number) => m / total;

  const surface =
    (byFit.good * FIT_WEIGHT.good +
      byFit.likely * FIT_WEIGHT.likely +
      byFit.uncertain * FIT_WEIGHT.uncertain) /
    total;
  // A loop that can't be ridden in one place can't be ridden at all, so unsuitable metres cost
  // far more than their share of the distance.
  const blocked = Math.max(0, 1 - share(byFit.unsuitable) * 4);
  const retraced = retracedShare(line);
  const outside = outsideShare(line, context.start, context.zoneRadiusM);
  const distanceError = Math.abs(leg.distanceM - context.targetM) / context.targetM;
  const shape =
    (1 - retraced * 0.8) *
    (1 - outside * 0.6) *
    Math.max(0.5, 1 - Math.max(0, distanceError - 0.1));
  const popular = context.segments
    ? popularOverlap(line, context.segments)
    : { share: 0, names: [] };
  // Popular stretches nudge confidence up but never lift a loop over its own surface problems.
  const lift = context.segments ? 0.9 + 0.1 * Math.min(1, popular.share / 0.2) : 1;
  const confidence = Math.round(Math.min(1, surface * blocked * shape * lift) * 100);

  const issues: RouteIssue[] = [...reasons.entries()]
    .filter(([, entry]) => entry.m >= 100)
    .sort((left, right) => right[1].m - left[1].m)
    .slice(0, 4)
    .map(([reason, entry]) => ({
      kind: entry.fit === "unsuitable" ? ("unsuitable" as const) : ("uncertain" as const),
      text: `${formatKm(entry.m)} ${reason}`,
    }));
  if (busyM >= 500) issues.push({ kind: "busy", text: `${formatKm(busyM)} on busy roads` });
  if (retraced >= 0.05) {
    issues.push({ kind: "retrace", text: `Rides ${formatKm(retraced * leg.distanceM)} twice` });
  }
  if (outside >= 0.05) {
    issues.push({ kind: "zone", text: `${formatKm(outside * leg.distanceM)} outside the zone` });
  }

  return {
    id,
    discipline,
    coordinates: leg.coordinates,
    stretches,
    distanceM: leg.distanceM,
    climbM: leg.climbM,
    confidence,
    shares: {
      good: share(byFit.good),
      likely: share(byFit.likely),
      uncertain: share(byFit.uncertain),
      unsuitable: share(byFit.unsuitable),
      unpaved: share(unpavedM),
      popular: popular.share,
      retraced,
      busy: share(busyM),
    },
    segments: popular.names,
    issues,
  };
}

function outsideShare(line: LngLat[], center: LngLat, radiusM: number) {
  let total = 0;
  let outside = 0;
  for (const sample of samples(line, 50)) {
    total += sample.lengthM;
    if (haversineM(sample.point, center) > radiusM * 1.05) outside += sample.lengthM;
  }
  return total > 0 ? outside / total : 0;
}

/** Share of `candidate` that runs over `other`, to drop near-duplicate proposals. */
export function overlapShare(candidate: LngLat[], other: LngLat[]) {
  const cells = new Set(samples(other, 15).flatMap((sample) => cellKeysAround(sample.point, 20)));
  let total = 0;
  let shared = 0;
  for (const sample of samples(candidate, 25)) {
    total += sample.lengthM;
    if (cells.has(cellKey(sample.point, 20))) shared += sample.lengthM;
  }
  return total > 0 ? shared / total : 0;
}
