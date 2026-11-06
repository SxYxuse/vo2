import { del, get, set } from "idb-keyval";

import type { ProposedRoute, RideDiscipline } from "@/services/route-builder.types.ts";
import type { LngLat } from "@/services/activity-map.types.ts";

/*
 * The zone and the last proposals, kept on the device like a GPX merge (ADR 0043, ADR 0062), so
 * the installed app comes back to them after the phone unloads it and the GPX still downloads
 * offline. Nothing about a proposal is stored on the server.
 */

export type RouteBuilderDraft = {
  discipline: RideDiscipline;
  start: LngLat | null;
  zoneRadiusKm: number;
  distanceKm: number;
  seed: number;
  routes: ProposedRoute[];
  popularityAvailable: boolean;
  selectedId: string | null;
};

const DRAFT_KEY = "vo2-route-builder";

export async function loadRouteBuilderDraft() {
  return (
    ((await get<unknown>(DRAFT_KEY).catch(() => undefined)) as RouteBuilderDraft | undefined) ??
    null
  );
}

export async function saveRouteBuilderDraft(draft: RouteBuilderDraft) {
  await set(DRAFT_KEY, draft).catch(() => undefined);
}

/** Signing out leaves no zone, which is often the athlete's home, on a shared device. */
export async function removeRouteBuilderDraft() {
  await del(DRAFT_KEY).catch(() => undefined);
}
