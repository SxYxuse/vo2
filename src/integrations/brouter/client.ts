import { env } from "@/configs/env.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import type { RideDiscipline, RoutedLeg } from "@/services/route-builder.types.ts";

/**
 * BRouter (https://github.com/abrensch/brouter) routes bikes over OpenStreetMap with profiles that
 * weigh surface, smoothness, and track grade. VO2 runs its own server (ADR 0062); the mock serves
 * the same HTTP shape when STRAVA_MOCK=1 and BROUTER_URL is unset.
 */

/** Stock profiles shipped with BRouter, with the options that suit each discipline. */
const PROFILES: Record<RideDiscipline, { profile: string; options: Record<string, string> }> = {
  road: {
    profile: "fastbike",
    options: { allow_steps: "0", allow_ferries: "0" },
  },
  gravel: {
    profile: "gravel",
    options: { prefer_unpaved_paths: "1" },
  },
};

export class BRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BRouterError";
  }
}

export function brouterAvailable() {
  return Boolean(env.BROUTER_URL);
}

type BRouterFeature = {
  properties?: {
    "track-length"?: string;
    "filtered ascend"?: string;
    messages?: string[][];
  };
  geometry?: { coordinates?: number[][] };
};

export async function routeThrough(
  discipline: RideDiscipline,
  lonlats: Array<[number, number]>,
): Promise<RoutedLeg> {
  if (!env.BROUTER_URL) throw new BRouterError("BRouter is not configured", 503);
  const { profile, options } = PROFILES[discipline];
  const search = new URLSearchParams({
    lonlats: lonlats.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join("|"),
    profile,
    alternativeidx: "0",
    format: "geojson",
  });
  // Profile switches take 1 and 0, not true and false.
  for (const [key, value] of Object.entries(options)) search.set(`profile:${key}`, value);

  const response = await fetch(`${env.BROUTER_URL}/brouter?${search.toString()}`, {
    signal: AbortSignal.timeout(60_000),
  }).catch((error: unknown) => {
    logger.warn("brouter.unreachable", errorFields(error));
    throw new BRouterError("BRouter is unreachable", 503);
  });
  if (!response.ok) {
    // BRouter answers with a plain-text reason, such as "target island detected".
    const reason = (await response.text()).trim().slice(0, 200);
    logger.warn("brouter.failed", { status: response.status, reason });
    throw new BRouterError(reason || `BRouter failed (${response.status})`, response.status);
  }
  const body = (await response.json()) as { features?: BRouterFeature[] };
  return parseFeature(body.features?.[0]);
}

function parseFeature(feature: BRouterFeature | undefined): RoutedLeg {
  const coordinates = (feature?.geometry?.coordinates ?? []).map(
    ([lng, lat, ele]) => [lng!, lat!, ele ?? null] as [number, number, number | null],
  );
  if (coordinates.length < 2) throw new BRouterError("BRouter returned no route", 502);

  const [header, ...rows] = feature?.properties?.messages ?? [];
  const column = (name: string) => header?.indexOf(name) ?? -1;
  const lngAt = column("Longitude");
  const latAt = column("Latitude");
  const distanceAt = column("Distance");
  const tagsAt = column("WayTags");

  // Each message row closes a stretch at its point, given in micro-degrees.
  const stretches: RoutedLeg["stretches"] = [];
  let cursor = 0;
  for (const row of rows) {
    const lng = Number(row[lngAt]) / 1e6;
    const lat = Number(row[latAt]) / 1e6;
    let best = cursor;
    let bestGap = Infinity;
    for (let index = cursor; index < coordinates.length; index += 1) {
      const [x, y] = coordinates[index]!;
      const gap = Math.abs(x - lng) + Math.abs(y - lat);
      if (gap < bestGap) {
        best = index;
        bestGap = gap;
      }
      if (gap < 1e-6) break;
    }
    cursor = best;
    stretches.push({
      endIndex: best,
      distanceM: Number(row[distanceAt]) || 0,
      tags: parseTags(row[tagsAt] ?? ""),
    });
  }
  const last = stretches.at(-1);
  if (last) last.endIndex = coordinates.length - 1;

  return {
    coordinates,
    stretches,
    distanceM: Number(feature?.properties?.["track-length"]) || 0,
    climbM: Number(feature?.properties?.["filtered ascend"]) || 0,
  };
}

function parseTags(text: string) {
  const tags: Record<string, string> = {};
  for (const pair of text.split(" ")) {
    const at = pair.indexOf("=");
    if (at > 0) tags[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return tags;
}
