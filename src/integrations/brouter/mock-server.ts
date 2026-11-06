import { env } from "@/configs/env.ts";

/**
 * Local stand-in for a BRouter server, mounted at /api/mock-brouter beside mock Strava when
 * BROUTER_URL is unset. It answers `GET /brouter` in BRouter's GeoJSON shape with a gently
 * winding line through the waypoints and made-up OSM tags, so the route builder, its scoring, and
 * the e2e screenshots run without map data. Set BROUTER_URL to route over real roads.
 */

type MockTags = { tags: string; weight: number };

/** Mostly well-tagged ways, plus a few the scoring should flag, so every badge appears. */
const TAGS: Record<string, MockTags[]> = {
  fastbike: [
    { tags: "highway=tertiary surface=asphalt", weight: 5 },
    { tags: "highway=residential", weight: 2 },
    { tags: "highway=secondary surface=asphalt", weight: 2 },
    { tags: "highway=primary surface=asphalt", weight: 1 },
    { tags: "highway=unclassified surface=sett", weight: 1 },
  ],
  gravel: [
    { tags: "highway=track tracktype=grade2 surface=compacted", weight: 4 },
    { tags: "highway=unclassified surface=asphalt", weight: 3 },
    { tags: "highway=track tracktype=grade3 surface=gravel", weight: 2 },
    { tags: "highway=track", weight: 1 },
    { tags: "highway=path surface=ground", weight: 1 },
  ],
};

const STEP_M = 80;
const STRETCH_M = 1600;

export async function handleMockBRouterRequest(request: Request): Promise<Response> {
  if (!env.STRAVA_MOCK) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/brouter")) return new Response("Not found", { status: 404 });

  const profile = url.searchParams.get("profile") ?? "fastbike";
  const waypoints = (url.searchParams.get("lonlats") ?? "")
    .split("|")
    .map((pair) => pair.split(",").map(Number) as [number, number])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (waypoints.length < 2) return new Response("lonlats missing", { status: 400 });

  const coordinates = windingLine(waypoints);
  const palette = TAGS[profile] ?? TAGS.fastbike!;
  const cycle = palette.flatMap((entry) => Array<string>(entry.weight).fill(entry.tags));
  const messages: string[][] = [
    ["Longitude", "Latitude", "Elevation", "Distance", "CostPerKm", "WayTags"],
  ];
  let stretchM = 0;
  let totalM = 0;
  let climbM = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const step = metres(coordinates[index - 1]!, coordinates[index]!);
    stretchM += step;
    totalM += step;
    climbM += Math.max(0, coordinates[index]![2] - coordinates[index - 1]![2]);
    const last = index === coordinates.length - 1;
    if (stretchM < STRETCH_M && !last) continue;
    const [lng, lat, ele] = coordinates[index]!;
    // A golden-ratio walk through the cycle, so neighbouring stretches rarely repeat.
    const tags = cycle[Math.floor((messages.length * 0.618 * cycle.length) % cycle.length)]!;
    messages.push([
      String(Math.round(lng * 1e6)),
      String(Math.round(lat * 1e6)),
      String(Math.round(ele)),
      String(Math.round(stretchM)),
      "1100",
      tags,
    ]);
    stretchM = 0;
  }

  return Response.json({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          creator: "VO2 mock BRouter",
          "track-length": String(Math.round(totalM)),
          "filtered ascend": String(Math.round(climbM)),
          messages,
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  });
}

/** Points every STEP_M between waypoints, nudged sideways so the line reads as roads. */
function windingLine(waypoints: Array<[number, number]>) {
  const out: Array<[number, number, number]> = [];
  waypoints.forEach((to, leg) => {
    const from = waypoints[leg - 1];
    if (!from) return;
    const length = metres([...from, 0], [...to, 0]);
    const steps = Math.max(1, Math.round(length / STEP_M));
    for (let step = leg === 1 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      const sway = Math.sin(t * Math.PI * 6) * Math.sin(t * Math.PI) * 0.0015;
      const lng = from[0] + (to[0] - from[0]) * t - (to[1] - from[1]) * sway * 40;
      const lat = from[1] + (to[1] - from[1]) * t + (to[0] - from[0]) * sway * 40;
      out.push([lng, lat, 60 + Math.sin(out.length / 25) * 30]);
    }
  });
  return out;
}

function metres(from: [number, number, number], to: [number, number, number]) {
  const latM = (to[1] - from[1]) * 111_320;
  const lngM = (to[0] - from[0]) * 111_320 * Math.cos((from[1] * Math.PI) / 180);
  return Math.hypot(latM, lngM);
}
