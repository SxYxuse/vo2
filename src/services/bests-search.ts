/**
 * Road runs, rides, and swims. Walks and other sports have no distance or output VO2 can rank,
 * so they are not shown on the bests page (ADR 0025).
 */
export const BESTS_SPORTS = ["running", "cycling", "swimming"] as const;
export type BestsSport = (typeof BESTS_SPORTS)[number];

/** All time, the last 12 months, the last 6 weeks, or one calendar year such as "2025". */
export type BestsPeriod = "all" | "12m" | "6w" | `${number}`;

/** The open tab, period, and board, kept in the URL so a return or a back gesture lands here. */
export type BestsSearch = { sport?: BestsSport; period?: BestsPeriod; best?: string };

export function parseBestsSearch(search: Record<string, unknown>): BestsSearch {
  const { sport, period, best } = search;
  const year = typeof period === "number" ? String(period) : period;
  return {
    ...(BESTS_SPORTS.includes(sport as BestsSport) ? { sport: sport as BestsSport } : {}),
    ...(year === "all" ||
    year === "12m" ||
    year === "6w" ||
    (typeof year === "string" && /^\d{4}$/.test(year))
      ? { period: year as BestsPeriod }
      : {}),
    ...(typeof best === "string" && /^[a-z]+-[a-z]+-[\d.]+$/.test(best) ? { best } : {}),
  };
}

/** An activity opened from the bests page, so its back link returns to the open board. */
export type BestsReturn = { from?: "bests"; best?: string; period?: BestsPeriod };

export function parseBestsReturn(search: Record<string, unknown>): BestsReturn {
  if (search.from !== "bests") return {};
  const { best, period } = parseBestsSearch(search);
  return { from: "bests", ...(best ? { best } : {}), ...(period ? { period } : {}) };
}
