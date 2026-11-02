import type { LngLat } from "./activity-map.types.ts";

/*
 * Merging GPX routes runs entirely on the device: files are parsed here, never uploaded, so the
 * page works offline and keeps nothing about the athlete on the server.
 */

export type GpxPoint = { lng: number; lat: number; ele: number | null };

export type GpxTrack = {
  id: string;
  name: string;
  points: GpxPoint[];
  /** Metres from the first point to each point, so a km position resolves by binary search. */
  distances: number[];
};

/** One stretch of the merged route: a track ridden from one position to another (backward when `toM < fromM`). */
export type MergeLeg = {
  id: string;
  trackId: string;
  fromM: number;
  toM: number;
  /** Starts at the point of this track nearest to where the previous leg ends, instead of `fromM`. */
  linked: boolean;
};

/** Where two tracks come within the meeting distance of each other. */
export type Junction = {
  id: string;
  /** A crossing is a brief contact; a shared stretch gives a junction where it joins and one where it splits. */
  kind: "cross" | "join" | "split";
  at: LngLat;
  a: { trackId: string; m: number };
  b: { trackId: string; m: number };
  gapM: number;
};

export class GpxError extends Error {}

const EARTH_RADIUS_M = 6_371_008.8;
const LAT_M = (Math.PI / 180) * EARTH_RADIUS_M;
const RAD = Math.PI / 180;

export function distanceM(from: GpxPoint, to: GpxPoint) {
  const dLat = (to.lat - from.lat) * RAD;
  const dLng = (to.lng - from.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.lat * RAD) * Math.cos(to.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cumulativeDistances(points: GpxPoint[]) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1]! + distanceM(points[index - 1]!, points[index]!));
  }
  return distances;
}

export function trackLength(track: GpxTrack) {
  return track.distances.at(-1) ?? 0;
}

export function makeTrack(id: string, name: string, points: GpxPoint[]): GpxTrack {
  return { id, name, points, distances: cumulativeDistances(points) };
}

// Regexes rather than DOMParser so parsing also runs in tests and never builds a DOM for a
// 50k-point file. Namespace prefixes (`<gpx:trkpt>`) are tolerated.
const POINT_PATTERN =
  /<(?:[\w-]+:)?(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>)/g;
const LAT_PATTERN = /\blat\s*=\s*["']([^"']+)["']/;
const LON_PATTERN = /\blon\s*=\s*["']([^"']+)["']/;
const ELE_PATTERN = /<(?:[\w-]+:)?ele\s*>\s*([^<]+?)\s*</;
const NAME_PATTERN = /<(?:[\w-]+:)?name\s*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\//;

function decodeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

/**
 * Reads the track points of a GPX file, all segments joined in order. Route points are used
 * only when the file has no track, as route planners export one or the other.
 */
export function parseGpx(xml: string, id: string, fallbackName: string): GpxTrack {
  if (!/<(?:[\w-]+:)?gpx\b/.test(xml)) throw new GpxError("This is not a GPX file.");
  const trackPoints: GpxPoint[] = [];
  const routePoints: GpxPoint[] = [];
  for (const [, tag, attributes, body] of xml.matchAll(POINT_PATTERN)) {
    const lat = Number(LAT_PATTERN.exec(attributes!)?.[1]);
    const lng = Number(LON_PATTERN.exec(attributes!)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const eleText = body ? ELE_PATTERN.exec(body)?.[1] : undefined;
    const ele = eleText === undefined ? null : Number(eleText);
    const point = { lng, lat, ele: ele !== null && Number.isFinite(ele) ? ele : null };
    (tag === "trkpt" ? trackPoints : routePoints).push(point);
  }
  const points = trackPoints.length ? trackPoints : routePoints;
  if (points.length < 2) throw new GpxError("This GPX file has no track to merge.");
  const name = decodeXml(NAME_PATTERN.exec(xml)?.[1]?.trim() ?? "") || fallbackName;
  return makeTrack(id, name, points);
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Index of the last point at or before `m`. */
function indexAt(distances: number[], m: number) {
  let low = 0;
  let high = distances.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (distances[mid]! <= m) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function pointAt(track: GpxTrack, m: number): GpxPoint {
  const { points, distances } = track;
  const at = clamp(m, 0, trackLength(track));
  const index = indexAt(distances, at);
  const from = points[index]!;
  const to = points[index + 1];
  if (!to) return from;
  const span = distances[index + 1]! - distances[index]!;
  const t = span > 0 ? (at - distances[index]!) / span : 0;
  return {
    lng: lerp(from.lng, to.lng, t),
    lat: lerp(from.lat, to.lat, t),
    ele: from.ele !== null && to.ele !== null ? lerp(from.ele, to.ele, t) : (from.ele ?? to.ele),
  };
}

/** The track between two positions, ends interpolated, reversed when `toM < fromM`. */
export function sliceTrack(track: GpxTrack, fromM: number, toM: number): GpxPoint[] {
  const length = trackLength(track);
  const low = clamp(Math.min(fromM, toM), 0, length);
  const high = clamp(Math.max(fromM, toM), 0, length);
  const slice = [pointAt(track, low)];
  for (let index = indexAt(track.distances, low) + 1; index < track.points.length; index += 1) {
    if (track.distances[index]! >= high) break;
    slice.push(track.points[index]!);
  }
  if (high > low) slice.push(pointAt(track, high));
  return toM < fromM ? slice.reverse() : slice;
}

/** Flat metres around an origin: plenty accurate over the few hundred metres a junction spans. */
function projector(origin: GpxPoint) {
  const lngM = LAT_M * Math.cos(origin.lat * RAD);
  return (point: GpxPoint) =>
    [(point.lng - origin.lng) * lngM, (point.lat - origin.lat) * LAT_M] as const;
}

function segmentProjection(
  px: number,
  py: number,
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1) : 0;
  return { t, distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) };
}

/** How much farther a pass may be and still win by lying nearer the hint (out-and-back roads). */
const PASS_SLACK_M = 30;

/**
 * The position on the track closest to a point, and how far away it is. With `nearM`, a track
 * passing the point more than once (an out-and-back) keeps to the pass nearest that position.
 */
export function nearestOnTrack(track: GpxTrack, target: GpxPoint, nearM?: number) {
  const project = projector(target);
  const projected = track.points.map(project);
  if (projected.length === 1) return { m: 0, gapM: Math.hypot(...projected[0]!) };
  const candidates: Array<{ m: number; gapM: number }> = [];
  let bestGap = Infinity;
  for (let index = 1; index < projected.length; index += 1) {
    const { t, distance } = segmentProjection(0, 0, projected[index - 1]!, projected[index]!);
    const from = track.distances[index - 1]!;
    candidates.push({ m: from + t * (track.distances[index]! - from), gapM: distance });
    bestGap = Math.min(bestGap, distance);
  }
  let best = candidates.find((candidate) => candidate.gapM === bestGap)!;
  if (nearM === undefined) return best;
  for (const candidate of candidates) {
    if (
      candidate.gapM <= bestGap + PASS_SLACK_M &&
      Math.abs(candidate.m - nearM) < Math.abs(best.m - nearM)
    ) {
      best = candidate;
    }
  }
  return best;
}

type Contact = { aM: number; bM: number; gapM: number; at: GpxPoint };

/**
 * Walks track A in steps no longer than the meeting distance and looks up B's nearby segments
 * in a grid, so it stays linear in the tracks' length and still catches a crossing between two
 * sparse points.
 */
function contactsBetween(a: GpxTrack, b: GpxTrack, toleranceM: number) {
  const project = projector(a.points[0]!);
  // Cells twice the meeting distance, with B's segments rasterised every half cell, put any
  // segment within reach of a sample in the sample's cell or one of its 8 neighbours.
  const cell = toleranceM * 2;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const projectedB = b.points.map(project);
  for (let index = 1; index < projectedB.length; index += 1) {
    const [ax, ay] = projectedB[index - 1]!;
    const [bx, by] = projectedB[index]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)));
    const keys = new Set<string>();
    for (let step = 0; step <= steps; step += 1) {
      keys.add(keyOf(lerp(ax, bx, step / steps), lerp(ay, by, step / steps)));
    }
    for (const key of keys) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }
  }

  const length = trackLength(a);
  // Very long tracks with a tight distance would sample too finely; 200k samples is plenty.
  const step = Math.max(toleranceM, length / 200_000);
  const samples = Math.max(1, Math.ceil(length / step));
  const contacts: Array<Contact | null> = [];
  for (let sample = 0; sample <= samples; sample += 1) {
    const aM = Math.min(length, sample * step);
    const at = pointAt(a, aM);
    const [px, py] = project(at);
    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);
    let best: Contact | null = null;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const index of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const { t, distance } = segmentProjection(
            px,
            py,
            projectedB[index - 1]!,
            projectedB[index]!,
          );
          if (distance > toleranceM || (best && distance >= best.gapM)) continue;
          const from = b.distances[index - 1]!;
          best = { aM, bM: from + t * (b.distances[index]! - from), gapM: distance, at };
        }
      }
    }
    contacts.push(best);
  }
  return { contacts, step };
}

export function findJunctions(a: GpxTrack, b: GpxTrack, toleranceM: number): Junction[] {
  if (a.points.length < 2 || b.points.length < 2 || toleranceM <= 0) return [];
  const { contacts, step } = contactsBetween(a, b, toleranceM);
  const runs: Contact[][] = [];
  let run: Contact[] = [];
  for (const contact of contacts) {
    const previous = run.at(-1);
    // A jump along B means A now runs beside a different pass of B (a loop or out-and-back).
    if (!contact || (previous && Math.abs(contact.bM - previous.bM) > step * 4)) {
      if (run.length) runs.push(run);
      run = contact ? [contact] : [];
    } else {
      run.push(contact);
    }
  }
  if (run.length) runs.push(run);

  const junctions: Junction[] = [];
  const add = (kind: Junction["kind"], contact: Contact) => {
    junctions.push({
      id: `${a.id}:${b.id}:${junctions.length}`,
      kind,
      at: [contact.at.lng, contact.at.lat],
      a: { trackId: a.id, m: contact.aM },
      b: { trackId: b.id, m: contact.bM },
      gapM: contact.gapM,
    });
  };
  for (const contacts of runs) {
    const first = contacts[0]!;
    const last = contacts.at(-1)!;
    if (last.aM - first.aM < toleranceM * 4) {
      add(
        "cross",
        contacts.reduce((best, contact) => (contact.gapM < best.gapM ? contact : best)),
      );
    } else {
      add("join", first);
      add("split", last);
    }
  }
  return junctions;
}

export function findAllJunctions(tracks: GpxTrack[], toleranceM: number) {
  const junctions: Junction[] = [];
  for (let left = 0; left < tracks.length; left += 1) {
    for (let right = left + 1; right < tracks.length; right += 1) {
      junctions.push(...findJunctions(tracks[left]!, tracks[right]!, toleranceM));
    }
  }
  return junctions;
}

/** A junction seen from one of its tracks: where it sits on that track and where it leads. */
export type JunctionStop = {
  junction: Junction;
  m: number;
  other: { trackId: string; m: number };
};

export function junctionStops(junctions: Junction[], trackId: string): JunctionStop[] {
  return junctions
    .flatMap((junction) => {
      if (junction.a.trackId === trackId) {
        return [{ junction, m: junction.a.m, other: junction.b }];
      }
      if (junction.b.trackId === trackId) {
        return [{ junction, m: junction.b.m, other: junction.a }];
      }
      return [];
    })
    .sort((left, right) => left.m - right.m);
}

export type RouteLeg = MergeLeg & {
  points: GpxPoint[];
  distanceM: number;
  /** Straight-line jump from the previous leg's end to this leg's start. */
  gapM: number;
};

export type MergedRoute = {
  legs: RouteLeg[];
  points: GpxPoint[];
  distanceM: number;
  gainM: number;
  lossM: number;
};

/** Device altitude wobbles by a few metres; ignore climbs smaller than this. */
const ELEVATION_NOISE_M = 3;

function elevationChange(points: GpxPoint[]) {
  let gainM = 0;
  let lossM = 0;
  let anchor: number | null = null;
  for (const { ele } of points) {
    if (ele === null) continue;
    if (anchor === null) {
      anchor = ele;
    } else if (ele - anchor >= ELEVATION_NOISE_M) {
      gainM += ele - anchor;
      anchor = ele;
    } else if (anchor - ele >= ELEVATION_NOISE_M) {
      lossM += anchor - ele;
      anchor = ele;
    }
  }
  return { gainM, lossM };
}

/** Joins the legs in order, resolving linked starts, into one route. */
export function buildMergedRoute(tracks: GpxTrack[], legs: MergeLeg[]): MergedRoute {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const routeLegs: RouteLeg[] = [];
  const points: GpxPoint[] = [];
  for (const leg of legs) {
    const track = byId.get(leg.trackId);
    if (!track) continue;
    const previous = points.at(-1);
    const length = trackLength(track);
    const fromM =
      leg.linked && previous
        ? nearestOnTrack(track, previous, leg.fromM).m
        : clamp(leg.fromM, 0, length);
    const toM = clamp(leg.toM, 0, length);
    const slice = sliceTrack(track, fromM, toM);
    const gapM = previous ? distanceM(previous, slice[0]!) : 0;
    routeLegs.push({ ...leg, fromM, toM, points: slice, distanceM: Math.abs(toM - fromM), gapM });
    // A leg that starts where the last one ended would repeat that point.
    points.push(...(previous && gapM < 0.5 ? slice.slice(1) : slice));
  }
  const distances = cumulativeDistances(points);
  return {
    legs: routeLegs,
    points,
    distanceM: distances.at(-1) ?? 0,
    ...elevationChange(points),
  };
}

/**
 * A first plan to edit: start on the first track and switch to each next one at their first
 * junction ahead, or jump straight to it when the two never meet.
 */
export function suggestLegs(
  tracks: GpxTrack[],
  junctions: Junction[],
  newId: () => string,
): MergeLeg[] {
  const [first, ...rest] = tracks;
  if (!first) return [];
  const legs: MergeLeg[] = [
    { id: newId(), trackId: first.id, fromM: 0, toM: trackLength(first), linked: false },
  ];
  for (const next of rest) {
    const current = legs.at(-1)!;
    const ahead = junctionStops(junctions, current.trackId).find(
      (stop) => stop.other.trackId === next.id && stop.m > current.fromM,
    );
    if (ahead) current.toM = ahead.m;
    legs.push({
      id: newId(),
      trackId: next.id,
      fromM: ahead?.other.m ?? 0,
      toM: trackLength(next),
      linked: Boolean(ahead),
    });
  }
  return legs;
}

/** 1 when a leg is ridden toward the end of its track, -1 when ridden back toward its start. */
export function legDirection(leg: { fromM: number; toM: number }) {
  return leg.toM < leg.fromM ? -1 : 1;
}

/**
 * Meeting points on a leg's track past where the leg starts, in riding order. `marginM` skips the
 * meeting point the leg starts from, which is no place to switch again.
 */
export function stopsAhead(
  stops: JunctionStop[],
  leg: { fromM: number; toM: number },
  marginM: number,
) {
  const direction = legDirection(leg);
  const ahead = stops.filter((stop) => (stop.m - leg.fromM) * direction > marginM);
  return direction < 0 ? ahead.reverse() : ahead;
}

/** The legs to store for a built route: linked starts keep where they resolved to. */
export function planLegs(route: MergedRoute): MergeLeg[] {
  return route.legs.map(({ id, trackId, fromM, toM, linked }) => ({
    id,
    trackId,
    fromM,
    toM,
    linked,
  }));
}

function trackById(tracks: GpxTrack[], id: string) {
  return tracks.find((track) => track.id === id);
}

/**
 * Switches from leg `index - 1` to leg `index` at a meeting point on the earlier leg's track: the
 * earlier leg ends there, and leg `index` carries on along the other track from the same spot.
 */
export function switchLegAt(
  legs: MergeLeg[],
  index: number,
  stop: JunctionStop,
  tracks: GpxTrack[],
): MergeLeg[] {
  const other = trackById(tracks, stop.other.trackId);
  const leg = legs[index];
  if (index < 1 || !leg || !other) return legs;
  return legs.map((item, at) => {
    if (at === index - 1) return { ...item, toM: stop.m };
    if (at !== index) return item;
    const toM = leg.trackId === other.id ? leg.toM : trackLength(other);
    return { ...leg, trackId: other.id, fromM: stop.other.m, toM, linked: true };
  });
}

/**
 * Puts leg `index` on another track, switching to it at the first meeting point ahead on the leg
 * before, or jumping straight to its start when the two never meet.
 */
export function changeLegTrack(
  route: MergedRoute,
  index: number,
  trackId: string,
  tracks: GpxTrack[],
  junctions: Junction[],
  marginM: number,
): MergeLeg[] {
  const legs = planLegs(route);
  const track = trackById(tracks, trackId);
  const leg = legs[index];
  if (!track || !leg) return legs;
  legs[index] = { ...leg, trackId, fromM: 0, toM: trackLength(track), linked: false };
  const previous = route.legs[index - 1];
  if (!previous) return legs;
  const stop = stopsAhead(junctionStops(junctions, previous.trackId), previous, marginM).find(
    (candidate) => candidate.other.trackId === trackId,
  );
  return stop ? switchLegAt(legs, index, stop, tracks) : legs;
}

/**
 * Adds a leg after the last one, switching at the first meeting point ahead with any other track,
 * or jumping to the next track's start when none is ahead.
 */
export function addLeg(
  route: MergedRoute,
  tracks: GpxTrack[],
  junctions: Junction[],
  marginM: number,
  newId: () => string,
): MergeLeg[] {
  const legs = planLegs(route);
  const last = route.legs.at(-1);
  const lastIndex = tracks.findIndex((track) => track.id === last?.trackId);
  const fallback = tracks[(lastIndex + 1) % tracks.length];
  if (!fallback) return legs;
  const fresh = { id: newId(), fromM: 0, linked: false };
  if (!last) return [{ ...fresh, trackId: fallback.id, toM: trackLength(fallback) }];
  const stop = stopsAhead(junctionStops(junctions, last.trackId), last, marginM)[0];
  if (!stop) return [...legs, { ...fresh, trackId: fallback.id, toM: trackLength(fallback) }];
  const other = trackById(tracks, stop.other.trackId);
  const added = [
    ...legs,
    { ...fresh, trackId: stop.other.trackId, toM: other ? trackLength(other) : 0 },
  ];
  return switchLegAt(added, added.length - 1, stop, tracks);
}

/**
 * Removes leg `index`. The leg after it starts where the leg before ends; when the last leg goes,
 * the one before rides on to the end of its track.
 */
export function removeLeg(route: MergedRoute, index: number, tracks: GpxTrack[]): MergeLeg[] {
  const legs = planLegs(route);
  legs.splice(index, 1);
  const next = legs[index];
  const previous = legs[index - 1];
  if (next && previous) legs[index] = { ...next, linked: true };
  if (!next && previous) {
    const track = trackById(tracks, previous.trackId);
    const end = legDirection(previous) > 0 && track ? trackLength(track) : 0;
    legs[index - 1] = { ...previous, toM: end };
  }
  return legs;
}

/** The first leg that rides past a junction, or -1. */
export function legPassing(route: MergedRoute, junction: Junction) {
  return route.legs.findIndex((leg) => {
    const side = [junction.a, junction.b].find((end) => end.trackId === leg.trackId);
    return (
      side !== undefined &&
      side.m >= Math.min(leg.fromM, leg.toM) &&
      side.m <= Math.max(leg.fromM, leg.toM)
    );
  });
}

/**
 * Changes track at a junction: the first leg passing it now ends there, and the route carries on
 * along the other track from the same spot (toward its finish). Null when no leg passes it.
 */
export function switchAtJunction(
  route: MergedRoute,
  tracks: GpxTrack[],
  junction: Junction,
  newId: () => string,
): MergeLeg[] | null {
  const index = legPassing(route, junction);
  if (index < 0) return null;
  const leg = route.legs[index]!;
  const [here, there] =
    junction.a.trackId === leg.trackId ? [junction.a, junction.b] : [junction.b, junction.a];
  const stop: JunctionStop = { junction, m: here.m, other: there };
  const legs = planLegs(route);
  // A next leg already on the other track is kept (with its finish); anything else gets a new leg.
  if (legs[index + 1]?.trackId !== there.trackId) {
    const other = trackById(tracks, there.trackId);
    if (!other) return null;
    legs.splice(index + 1, 0, {
      id: newId(),
      trackId: other.id,
      fromM: 0,
      toM: trackLength(other),
      linked: false,
    });
  }
  return switchLegAt(legs, index + 1, stop, tracks);
}

function escapeXml(text: string) {
  return text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function toGpx(name: string, points: GpxPoint[]) {
  const trackPoints = points
    .map(({ lat, lng, ele }) => {
      const elevation = ele === null ? "" : `<ele>${ele.toFixed(1)}</ele>`;
      return `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${elevation}</trkpt>`;
    })
    .join("\n");
  const title = escapeXml(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VO2" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${title}</name></metadata>
  <trk>
    <name>${title}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}
