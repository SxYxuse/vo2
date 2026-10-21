export const MAX_GPX_BYTES = 5 * 1024 * 1024;
/** Resampling step: fine enough for short pitches, coarse enough to drop GPS jitter. */
export const STEP_M = 50;
/** Rolling median over this many steps (250 m) before grades are taken. */
const ALTITUDE_MEDIAN_STEPS = 5;
/** Gain and loss only count once the road has moved this far from the last turn. */
const GAIN_HYSTERESIS_M = 3;
/** Grade is taken over this many steps on each side (±100 m). */
const GRADE_HALF_STEPS = 2;

export type GpxPoint = { lat: number; lon: number; ele: number | null };

export class GpxError extends Error {}

export type RouteStep = {
  /** Distance from the start to the beginning of the step. */
  distanceM: number;
  lengthM: number;
  /** Smoothed; 0 everywhere on a route without elevation. */
  altitudeM: number;
  gradePct: number;
  lat: number;
  lon: number;
};

export type RouteProfile = {
  name: string | null;
  distanceM: number;
  gainM: number;
  lossM: number;
  hasElevation: boolean;
  steps: RouteStep[];
};

function attribute(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(tag);
  return match ? Number(match[1]) : Number.NaN;
}

/**
 * Reads track points, or route points when the file has no track. A tiny scan rather than an
 * XML parser, so it runs the same in tests and on the server.
 */
export function parseGpx(text: string): { name: string | null; points: GpxPoint[] } {
  if (text.length > MAX_GPX_BYTES) throw new GpxError("This GPX file is larger than 5 MB.");
  if (!/<gpx[\s>]/i.test(text)) throw new GpxError("This file is not a GPX route.");

  const read = (tagName: "trkpt" | "rtept") => {
    const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, "gi");
    const points: GpxPoint[] = [];
    for (const match of text.matchAll(pattern)) {
      const lat = attribute(match[1] ?? "", "lat");
      const lon = attribute(match[1] ?? "", "lon");
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const ele = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/.exec(match[2] ?? "");
      const elevation = ele ? Number(ele[1]) : Number.NaN;
      points.push({ lat, lon, ele: Number.isFinite(elevation) ? elevation : null });
    }
    return points;
  };

  const track = read("trkpt");
  const points = track.length > 0 ? track : read("rtept");
  if (points.length < 2) throw new GpxError("This GPX file has no route points.");
  const name = /<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i.exec(text)?.[1]?.trim();
  return { name: name || null, points };
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineM(a: GpxPoint, b: GpxPoint) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function interpolateAt(
  points: GpxPoint[],
  cumulative: number[],
  positions: number[],
  value: (point: GpxPoint) => number | null,
) {
  const known = points.flatMap((point, index) => {
    const amount = value(point);
    return amount == null ? [] : [{ distance: cumulative[index] ?? 0, amount }];
  });
  if (known.length === 0) return null;
  let cursor = 0;
  return positions.map((position) => {
    while (cursor + 1 < known.length && (known[cursor + 1]?.distance ?? 0) <= position) cursor += 1;
    const a = known[cursor];
    const b = known[cursor + 1];
    if (!a) return 0;
    if (!b || position <= a.distance) return a.amount;
    const span = b.distance - a.distance;
    return span > 0
      ? a.amount + ((b.amount - a.amount) * (position - a.distance)) / span
      : a.amount;
  });
}

/** Elevation at each resampled position, linearly interpolated, with gaps bridged. */
function elevationAt(points: GpxPoint[], cumulative: number[], positions: number[]) {
  return interpolateAt(points, cumulative, positions, (point) => point.ele);
}

function coordAt(
  points: GpxPoint[],
  cumulative: number[],
  positions: number[],
  axis: "lat" | "lon",
) {
  return (
    interpolateAt(points, cumulative, positions, (point) => point[axis]) ?? positions.map(() => 0)
  );
}

function gainAndLoss(altitudes: number[]) {
  let gain = 0;
  let loss = 0;
  let anchor = altitudes[0] ?? 0;
  for (const altitude of altitudes) {
    const delta = altitude - anchor;
    if (delta >= GAIN_HYSTERESIS_M) {
      gain += delta;
      anchor = altitude;
    } else if (delta <= -GAIN_HYSTERESIS_M) {
      loss -= delta;
      anchor = altitude;
    }
  }
  return { gain, loss };
}

/** Resamples the route into even steps with smoothed altitude and grade. */
export function buildRouteProfile(input: {
  name: string | null;
  points: GpxPoint[];
}): RouteProfile {
  const { points } = input;
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    cumulative.push((cumulative[index - 1] ?? 0) + (a && b ? haversineM(a, b) : 0));
  }
  const distanceM = cumulative.at(-1) ?? 0;
  if (distanceM < STEP_M) throw new GpxError("This route is too short to plan.");

  const positions: number[] = [];
  // A last stub under a fifth of a step joins the step before it.
  for (let position = 0; position < distanceM - STEP_M / 5; position += STEP_M) {
    positions.push(position);
  }
  positions.push(distanceM);

  const raw = elevationAt(points, cumulative, positions);
  const hasElevation = raw != null;
  const half = Math.floor(ALTITUDE_MEDIAN_STEPS / 2);
  const altitudes = raw
    ? raw.map((_, index) => median(raw.slice(Math.max(0, index - half), index + half + 1)))
    : positions.map(() => 0);
  const lats = coordAt(points, cumulative, positions, "lat");
  const lons = coordAt(points, cumulative, positions, "lon");

  const steps: RouteStep[] = [];
  for (let index = 0; index + 1 < positions.length; index += 1) {
    const low = Math.max(0, index - GRADE_HALF_STEPS);
    const high = Math.min(positions.length - 1, index + 1 + GRADE_HALF_STEPS);
    const run = (positions[high] ?? 0) - (positions[low] ?? 0);
    const rise = (altitudes[high] ?? 0) - (altitudes[low] ?? 0);
    steps.push({
      distanceM: positions[index] ?? 0,
      lengthM: (positions[index + 1] ?? 0) - (positions[index] ?? 0),
      altitudeM: Math.round((altitudes[index] ?? 0) * 10) / 10,
      gradePct: run > 0 ? Math.round((rise / run) * 1000) / 10 : 0,
      lat: Math.round((lats[index] ?? 0) * 1e6) / 1e6,
      lon: Math.round((lons[index] ?? 0) * 1e6) / 1e6,
    });
  }

  const { gain, loss } = gainAndLoss(altitudes);
  return {
    name: input.name,
    distanceM: Math.round(distanceM),
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    hasElevation,
    steps,
  };
}
