/**
 * The per-activity summaries built lazily from `activity_streams` and cached back on that row:
 * the detail view builds the ride and heart analyses, the fitness page the best efforts, the paces the flat running by heart rate. Clear
 * them together whenever their inputs change; the next read rebuilds them. An algorithm change
 * bumps the version each one carries instead (`isRideAnalysis`, `isHeartAnalysis`,
 * `isBestEfforts`, `isFlatPaces`). The chart preview is not listed: the sync rewrites it with every stream
 * copy, and it reads only the streams.
 */
export const CLEARED_DERIVED_CACHES = {
  rideAnalysis: null,
  heartAnalysis: null,
  bestEfforts: null,
  flatPaces: null,
} as const;

/** The activity fields the derived caches are built from, besides the streams. */
export type DerivedCacheInputs = {
  id: string;
  sportType: string;
  distance: number | null;
  totalElevationGain: number | null;
};

/** Ids of stored activities whose cache inputs differ in the fresh copy from Strava. */
export function staleDerivedCacheIds(
  stored: DerivedCacheInputs[],
  fresh: DerivedCacheInputs[],
): string[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  return fresh.flatMap((row) => {
    const before = byId.get(row.id);
    if (!before) return [];
    const changed =
      before.sportType !== row.sportType ||
      !sameReal(before.distance, row.distance) ||
      !sameReal(before.totalElevationGain, row.totalElevationGain);
    return changed ? [row.id] : [];
  });
}

// Both columns are Postgres `real`: a stored value reads back rounded to float4, so compare
// Strava's double at that precision or every refresh would look like an edit.
function sameReal(stored: number | null, fresh: number | null) {
  if (stored == null || fresh == null) return stored == fresh;
  return Math.fround(stored) === Math.fround(fresh);
}
