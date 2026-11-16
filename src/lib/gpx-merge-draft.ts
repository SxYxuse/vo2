import { delMany, getMany, set } from "idb-keyval";

import type { GpxTrack, MergeLeg } from "@/services/gpx-merge.ts";

export type GpxMergeTrack = GpxTrack & { color: string };

export type GpxMergePlan = {
  legs: MergeLeg[];
  toleranceM: number;
  name: string;
};

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

export async function removeGpxMergeDraft() {
  await delMany([TRACKS_KEY, PLAN_KEY]).catch(() => undefined);
}
