import { delMany, getMany, set } from "idb-keyval";

import type { GpxTrack, MergeLeg } from "@/services/gpx-merge.ts";

/*
 * The merge in progress, kept on the device so an installed app that iOS or Android unloaded in
 * the background comes back with the same files and legs. It is never sent to the server.
 */

export type GpxMergeTrack = GpxTrack & { color: string };

export type GpxMergePlan = {
  legs: MergeLeg[];
  toleranceM: number;
  name: string;
};

// Tracks can hold tens of thousands of points; storing them apart keeps every slider move from
// cloning them all again.
const TRACKS_KEY = "vo2-gpx-merge-tracks";
const PLAN_KEY = "vo2-gpx-merge-plan";

export async function loadGpxMergeDraft() {
  const [tracks, plan] = await getMany<unknown>([TRACKS_KEY, PLAN_KEY]).catch(() => []);
  return {
    tracks: (tracks as GpxMergeTrack[] | undefined) ?? [],
    plan: (plan as GpxMergePlan | undefined) ?? null,
  };
}

export async function saveGpxMergeTracks(tracks: GpxMergeTrack[]) {
  await set(TRACKS_KEY, tracks).catch(() => undefined);
}

export async function saveGpxMergePlan(plan: GpxMergePlan) {
  await set(PLAN_KEY, plan).catch(() => undefined);
}

/** Signing out leaves nothing of the athlete's routes on a shared device. */
export async function removeGpxMergeDraft() {
  await delMany([TRACKS_KEY, PLAN_KEY]).catch(() => undefined);
}
