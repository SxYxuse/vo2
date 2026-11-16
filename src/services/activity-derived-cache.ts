export const CLEARED_DERIVED_CACHES = {
  rideAnalysis: null,
  heartAnalysis: null,
  bestEfforts: null,
  flatPaces: null,
} as const;

export type DerivedCacheInputs = {
  id: string;
  sportType: string;
  distance: number | null;
  totalElevationGain: number | null;
};

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
