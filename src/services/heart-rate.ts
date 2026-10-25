import { createServerFn } from "@tanstack/react-start";

import { formatSportType, type AthleteSettings } from "./athlete-settings.types.ts";
import type { HeartRateSettings } from "./heart-rate-settings.ts";
import {
  estimateMaxHrAnchor,
  type EfficiencyKind,
  type EfficiencyPoint,
  type HeartPeak,
  type MaxHrAnchor,
} from "./heart-insights.ts";
import { SPORT_GROUPS, sharesGroupData, sportGroupFor, type SportGroupId } from "./sport-groups.ts";

export const ALL_SPORTS = "all";
export const BPM_MIN = 40;
export const BPM_MAX = 230;

export const HR_ZONES = [
  {
    id: "z1",
    label: "Zone 1",
    name: "Recovery",
    // Gray to red, cool to hot, so the zone order reads from the color alone.
    color: "var(--color-ds-gray-700)",
    info: "Easy effort. Breathing is light and you can talk in full sentences. Used for recovery and long aerobic time.",
  },
  {
    id: "z2",
    label: "Zone 2",
    name: "Endurance",
    color: "var(--color-ds-blue-700)",
    info: "Aerobic base. Conversational but purposeful. Most weekly volume should live here.",
  },
  {
    id: "z3",
    label: "Zone 3",
    name: "Tempo",
    color: "var(--color-ds-green-700)",
    info: "Steady hard. Talking becomes short phrases. Useful in controlled blocks, easy to overdo.",
  },
  {
    id: "z4",
    label: "Zone 4",
    name: "Threshold",
    color: "var(--color-ds-amber-700)",
    info: "Near lactate threshold. Uncomfortable and sustainable only in intervals or short continuous efforts.",
  },
  {
    id: "z5",
    label: "Zone 5",
    name: "VO2 max",
    color: "var(--color-ds-red-700)",
    info: "Very hard. Breathing is maxed. Short repeats that raise the ceiling, not all-day pace.",
  },
] as const;

export type HeartRateZoneId = (typeof HR_ZONES)[number]["id"];
export type HeartRateFamily = "cycling" | "running" | "swimming" | "walking" | "other";

/** How a sport's zones are cut: % of LTHR, % of max HR, heart-rate reserve, or custom bpm. */
export type ZoneMethod = "lthr" | "max" | "reserve" | "custom";

/** Everything a zone method may read. Walking and other sports always use % of max. */
export type ZoneAnchors = {
  maxHr: number | null;
  lthr: number | null;
  restHr?: number | null;
  method?: ZoneMethod;
  /** Tops of zones 1 to 4 in bpm, used by the custom method. */
  customZones?: number[] | null;
};

type ZoneBand = {
  id: HeartRateZoneId;
  toPct: number | null;
};

type ZoneModel = {
  family: HeartRateFamily;
  anchor: "lthr" | "hrmax";
  label: string;
  lthrFactor: number;
  bands: ZoneBand[];
};

const FAMILY_BY_GROUP: Record<SportGroupId, HeartRateFamily> = {
  cycling: "cycling",
  running: "running",
  swimming: "swimming",
  walking: "walking",
};

/** Karvonen: zone 1 tops out at 60 % of reserve, zone 5 starts above 90 %. */
const RESERVE_BANDS: ZoneBand[] = [
  { id: "z1", toPct: 0.6 },
  { id: "z2", toPct: 0.7 },
  { id: "z3", toPct: 0.8 },
  { id: "z4", toPct: 0.9 },
  { id: "z5", toPct: null },
];

const POLAR_HRMAX_BANDS: ZoneBand[] = [
  { id: "z1", toPct: 0.6 },
  { id: "z2", toPct: 0.7 },
  { id: "z3", toPct: 0.8 },
  { id: "z4", toPct: 0.9 },
  { id: "z5", toPct: null },
];

const ZONE_MODELS: Record<HeartRateFamily, ZoneModel> = {
  cycling: {
    family: "cycling",
    anchor: "lthr",
    label: "Coggan · % of cycling LTHR",
    lthrFactor: 0.83,
    bands: [
      { id: "z1", toPct: 0.68 },
      { id: "z2", toPct: 0.83 },
      { id: "z3", toPct: 0.94 },
      { id: "z4", toPct: 1.05 },
      { id: "z5", toPct: null },
    ],
  },
  running: {
    family: "running",
    anchor: "lthr",
    label: "Friel · % of running LTHR",
    lthrFactor: 0.88,
    bands: [
      { id: "z1", toPct: 0.84 },
      { id: "z2", toPct: 0.89 },
      { id: "z3", toPct: 0.94 },
      { id: "z4", toPct: 0.99 },
      { id: "z5", toPct: null },
    ],
  },
  swimming: {
    family: "swimming",
    anchor: "lthr",
    label: "CSS · % of swimming LTHR",
    lthrFactor: 0.85,
    bands: [
      { id: "z1", toPct: 0.8 },
      { id: "z2", toPct: 0.87 },
      { id: "z3", toPct: 0.93 },
      { id: "z4", toPct: 0.99 },
      { id: "z5", toPct: null },
    ],
  },
  walking: {
    family: "walking",
    anchor: "hrmax",
    label: "% of walking max HR",
    lthrFactor: 0.85,
    bands: POLAR_HRMAX_BANDS,
  },
  other: {
    family: "other",
    anchor: "hrmax",
    label: "% of max HR",
    lthrFactor: 0.85,
    bands: POLAR_HRMAX_BANDS,
  },
};

export type HeartRateZoneStat = {
  id: HeartRateZoneId;
  minBpm: number | null;
  maxBpm: number | null;
  seconds: number;
};

/** One activity's time in each zone (same order as `HR_ZONES`), so the page can filter by period. */
export type HeartRateSession = {
  start: string;
  zoneSeconds: number[];
  /** Time-weighted average of the plausible samples; null without any. */
  avgBpm: number | null;
};

export type HeartRateSport = {
  sportType: string;
  members: string[];
  family: HeartRateFamily | null;
  zoneModel: string;
  /** Null on the all-sports view, where each sport keeps its own. */
  zoneMethod: ZoneMethod | null;
  /** Zone anchor: the athlete's max, else recent max HR without spikes, or the age prediction. */
  maxHeartrate: number | null;
  maxAnchor: MaxHrAnchor | null;
  lthr: number | null;
  lthrSource: AnchorSource | null;
  restHr: number | null;
  customZones: number[] | null;
  activityCount: number;
  sampleSeconds: number;
  peakActivityName: string | null;
  peakActivityStart: string | null;
  zones: HeartRateZoneStat[];
  /** Start of every activity with heart rate, streams or not. */
  activityStarts: string[];
  sessions: HeartRateSession[];
  efficiencyKind: EfficiencyKind | null;
  efficiency: EfficiencyPoint[];
};

/** The athlete's heart-rate settings and the stored estimates every view resolves zones from. */
export type AthleteHeartRate = {
  settings?: HeartRateSettings;
  restHr: number | null;
  lthr: Partial<Record<ZonedFamily, number | null>>;
};

export type HeartRateData = {
  signedIn: boolean;
  overall: HeartRateSport;
  sports: HeartRateSport[];
  sportTypes: AthleteSettings["sportTypes"];
};

export type SportBucket = {
  sportType: string;
  histogram: number[];
  peaks: HeartPeak[];
  activityStarts: string[];
  activityCount: number;
  maxHeartrate: number;
  peakActivityName: string | null;
  peakActivityStart: string | null;
};

/** The sports with an LTHR model; walking and other sports always cut % of max (ADR 0021). */
export const ZONED_FAMILIES = ["cycling", "running", "swimming"] as const;
export type ZonedFamily = (typeof ZONED_FAMILIES)[number];

export function isZonedFamily(family: HeartRateFamily | null): family is ZonedFamily {
  return family === "cycling" || family === "running" || family === "swimming";
}

export type AnchorSource = "athlete" | "estimated";

/** One sport's estimates, before anything the athlete set. */
export type FamilyEstimates = {
  restHr: number | null;
  maxHr: number | null;
  /** A stored LTHR estimate; without one, LTHR is a share of max. */
  lthr?: number | null;
};

export type ResolvedHeartRate = Required<ZoneAnchors> & {
  method: ZoneMethod;
  maxSource: AnchorSource | null;
  lthrSource: AnchorSource | null;
  restSource: AnchorSource | null;
};

function anchorSource(set: number | null, value: number | null): AnchorSource | null {
  if (set != null) return "athlete";
  return value != null ? "estimated" : null;
}

/** A set anchor wins over the estimate, and estimates build on set anchors. */
export function resolveHeartRate(
  family: ZonedFamily,
  settings: HeartRateSettings | undefined,
  estimates: FamilyEstimates,
): ResolvedHeartRate {
  const sport = settings?.sports[family];
  const setMax = sport?.maxHr ?? null;
  const setLthr = sport?.lthr ?? null;
  const setRest = settings?.restHr ?? null;
  const maxHr = setMax ?? estimates.maxHr;
  // A stored estimate was built on the estimated max, so a set max re-derives it.
  const estimatedLthr =
    (setMax == null ? estimates.lthr : null) ?? estimateLthrFromMax(maxHr, family);
  const lthr = setLthr ?? estimatedLthr;
  const restHr = setRest ?? estimates.restHr;
  return {
    method: sport?.method ?? "lthr",
    maxHr,
    maxSource: anchorSource(setMax, maxHr),
    lthr,
    lthrSource: anchorSource(setLthr, lthr),
    restHr,
    restSource: anchorSource(setRest, restHr),
    customZones: sport?.customZones ?? null,
  };
}

/** The anchor a sport's method needs but has no value for, if any. */
export function missingAnchor(
  resolved: ResolvedHeartRate,
): "max" | "lthr" | "rest" | "zones" | null {
  if (resolved.method === "custom" && resolved.customZones?.length !== 4) return "zones";
  if (resolved.method === "lthr" && resolved.lthr == null) return "lthr";
  if ((resolved.method === "max" || resolved.method === "reserve") && resolved.maxHr == null) {
    return "max";
  }
  if (resolved.method === "reserve" && resolved.restHr == null) return "rest";
  return null;
}

export function heartRateFamily(sportType: string): HeartRateFamily {
  const group = sportGroupFor(sportType);
  return group ? FAMILY_BY_GROUP[group.id] : "other";
}

export function zoneModelFor(sportType: string) {
  return ZONE_MODELS[heartRateFamily(sportType)];
}

export function emptyHistogram() {
  return Array.from({ length: BPM_MAX + 1 }, () => 0);
}

export function isPlausibleBpm(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value >= BPM_MIN && value <= BPM_MAX;
}

export function histogramSeconds(histogram: number[]) {
  return histogram.reduce((sum, seconds) => sum + seconds, 0);
}

export function histogramAvgBpm(histogram: number[]) {
  let sum = 0;
  let seconds = 0;
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 1) {
    sum += bpm * (histogram[bpm] ?? 0);
    seconds += histogram[bpm] ?? 0;
  }
  return seconds > 0 ? Math.round((sum / seconds) * 10) / 10 : null;
}

export function histogramMaxBpm(histogram: number[]) {
  for (let bpm = BPM_MAX; bpm >= BPM_MIN; bpm -= 1) {
    if ((histogram[bpm] ?? 0) > 0) return bpm;
  }
  return null;
}

function pctBpm(anchor: number, pct: number) {
  return Math.round(anchor * pct);
}

export function estimateLthrFromMax(maxHeartrate: number | null, family: HeartRateFamily) {
  if (!maxHeartrate) return null;
  const minMax = family === "swimming" ? 90 : 120;
  if (maxHeartrate < minMax) return null;
  return Math.round(maxHeartrate * ZONE_MODELS[family].lthrFactor);
}

export function zoneMethodFor(sportType: string, method: ZoneMethod | undefined): ZoneMethod {
  const model = zoneModelFor(sportType);
  if (model.anchor === "hrmax") return "max";
  return method ?? "lthr";
}

type Bound = { id: HeartRateZoneId; minBpm: number; maxBpm: number };

function boundsFromTops(tops: number[]): Bound[] {
  return HR_ZONES.map((zone, index) => {
    const minBpm = index === 0 ? 0 : tops[index - 1] + 1;
    const maxBpm = index < tops.length ? tops[index] : BPM_MAX;
    return { id: zone.id, minBpm, maxBpm: Math.max(minBpm, maxBpm) };
  });
}

function zoneBounds(sportType: string, anchors: ZoneAnchors, peak: number): Bound[] {
  const model = zoneModelFor(sportType);
  const method = zoneMethodFor(sportType, anchors.method);
  if (method === "custom") {
    const tops = anchors.customZones;
    return tops?.length === 4 ? boundsFromTops(tops) : [];
  }
  if (method === "reserve") {
    const rest = anchors.restHr;
    if (!rest || peak <= rest) return [];
    return boundsFromTops(
      RESERVE_BANDS.slice(0, 4).map((band) => Math.round(rest + (peak - rest) * (band.toPct ?? 1))),
    );
  }
  const bands = method === "max" ? POLAR_HRMAX_BANDS : model.bands;
  // No silent fallback: a missing LTHR shows no zones rather than a different method.
  const anchor = method === "lthr" ? (anchors.lthr ?? 0) : peak;
  if (anchor <= 0) return [];
  return boundsFromTops(bands.slice(0, 4).map((band) => pctBpm(anchor, band.toPct ?? 1)));
}

export function zonesFromHistogram(
  histogram: number[],
  sportType: string,
  anchors: ZoneAnchors,
): HeartRateZoneStat[] {
  const peak = anchors.maxHr ?? histogramMaxBpm(histogram) ?? 0;
  const bounds = zoneBounds(sportType, anchors, peak);
  return HR_ZONES.map((zone, index) => {
    const bound = bounds[index];
    let seconds = 0;
    if (bound) {
      const from = Math.max(BPM_MIN, bound.minBpm);
      const to = Math.min(BPM_MAX, bound.maxBpm);
      for (let bpm = from; bpm <= to; bpm += 1) {
        seconds += histogram[bpm] ?? 0;
      }
    }
    const isLast = index === HR_ZONES.length - 1;
    const displayMax = bound ? Math.min(peak || bound.maxBpm, bound.maxBpm) : 0;
    return {
      id: zone.id,
      minBpm: bound ? bound.minBpm : null,
      maxBpm: bound ? (isLast ? peak || displayMax : displayMax) : null,
      seconds,
    };
  });
}

export function createSportBucket(sportType: string): SportBucket {
  return {
    sportType,
    histogram: emptyHistogram(),
    peaks: [],
    activityStarts: [],
    activityCount: 0,
    maxHeartrate: 0,
    peakActivityName: null,
    peakActivityStart: null,
  };
}

export function noteActivityPeak(
  bucket: SportBucket,
  input: {
    maxHeartrate: number | null;
    averageHeartrate?: number | null;
    name: string;
    start: string;
  },
) {
  bucket.activityCount += 1;
  bucket.activityStarts.push(input.start);
  if (!isPlausibleBpm(input.maxHeartrate)) return;
  const bpm = Math.round(input.maxHeartrate ?? 0);
  bucket.peaks.push({
    bpm,
    start: input.start,
    name: input.name,
    avgBpm: input.averageHeartrate ?? null,
  });
  if (bpm < bucket.maxHeartrate) return;
  if (
    bpm === bucket.maxHeartrate &&
    bucket.peakActivityStart &&
    input.start < bucket.peakActivityStart
  ) {
    return;
  }
  bucket.maxHeartrate = bpm;
  bucket.peakActivityName = input.name;
  bucket.peakActivityStart = input.start;
}

/** The max HR the athlete set for a sport, if any. */
export function athleteMaxHr(family: HeartRateFamily, athlete: AthleteHeartRate | undefined) {
  return isZonedFamily(family) ? (athlete?.settings?.sports[family].maxHr ?? null) : null;
}

/** One sport's zone anchors: the athlete's settings over the estimates. */
export function sportHeartRate(
  family: HeartRateFamily,
  maxHr: number | null,
  athlete: AthleteHeartRate | undefined,
): ResolvedHeartRate {
  const estimates = { restHr: athlete?.restHr ?? null, maxHr };
  if (isZonedFamily(family)) {
    return resolveHeartRate(family, athlete?.settings, {
      ...estimates,
      lthr: athlete?.lthr[family],
    });
  }
  const restHr = athlete?.settings?.restHr ?? estimates.restHr;
  return {
    method: "max",
    maxHr,
    maxSource: anchorSource(null, maxHr),
    // Shown for reference only; walking and other sports cut zones from max.
    lthr: estimateLthrFromMax(maxHr, family),
    lthrSource: null,
    restHr,
    restSource: anchorSource(athlete?.settings?.restHr ?? null, restHr),
    customZones: null,
  };
}

export function zoneMethodLabel(family: HeartRateFamily, method: ZoneMethod) {
  if (method === "lthr" || !isZonedFamily(family)) return ZONE_MODELS[family].label;
  if (method === "max") return `% of ${family} max HR`;
  if (method === "reserve") return "Heart-rate reserve";
  return "Custom zones";
}

function sportZoneAnchors(sport: HeartRateSport): ZoneAnchors {
  return {
    maxHr: sport.maxHeartrate,
    lthr: sport.lthr,
    restHr: sport.restHr,
    method: sport.zoneMethod ?? undefined,
    customZones: sport.customZones,
  };
}

export function toHeartRateSport(
  bucket: SportBucket,
  athlete?: AthleteHeartRate,
  options: { age?: number | null; now?: Date } = {},
): HeartRateSport {
  const family = heartRateFamily(bucket.sportType);
  const peaks = bucket.peaks.length
    ? bucket.peaks
    : bucket.maxHeartrate > 0 && bucket.peakActivityStart
      ? [{ bpm: bucket.maxHeartrate, start: bucket.peakActivityStart }]
      : [];
  const maxAnchor = estimateMaxHrAnchor(peaks, {
    family,
    age: options.age,
    now: options.now,
    athleteBpm: athleteMaxHr(family, athlete),
  });
  const maxHeartrate = maxAnchor.bpm ?? histogramMaxBpm(bucket.histogram);
  const resolved = sportHeartRate(family, maxHeartrate, athlete);
  return {
    sportType: bucket.sportType,
    members: [bucket.sportType],
    family,
    zoneModel: zoneMethodLabel(family, resolved.method),
    zoneMethod: resolved.method,
    maxHeartrate,
    maxAnchor,
    lthr: resolved.lthr,
    lthrSource: resolved.lthrSource,
    restHr: resolved.restHr,
    customZones: resolved.customZones,
    activityCount: bucket.activityCount,
    sampleSeconds: histogramSeconds(bucket.histogram),
    peakActivityName: maxAnchor.peak?.name ?? null,
    peakActivityStart: maxAnchor.peak?.start ?? null,
    zones: zonesFromHistogram(bucket.histogram, bucket.sportType, resolved),
    activityStarts: bucket.activityStarts,
    sessions: [],
    efficiencyKind: null,
    efficiency: [],
  };
}

/** Adds one activity's samples to a sport whose zone bounds are already set. */
export function addSessionToSport(sport: HeartRateSport, start: string, histogram: number[]) {
  const zones = zonesFromHistogram(histogram, sport.sportType, sportZoneAnchors(sport));
  const zoneSeconds = zones.map((zone) => zone.seconds);
  sport.sessions.push({ start, zoneSeconds, avgBpm: histogramAvgBpm(histogram) });
  sport.sampleSeconds += zoneSeconds.reduce((sum, seconds) => sum + seconds, 0);
  sport.zones = sport.zones.map((zone, index) => ({
    ...zone,
    seconds: zone.seconds + (zoneSeconds[index] ?? 0),
  }));
}

/**
 * Time in zone and activity count for activities since `startMs` (null: all time).
 * Zone bounds and max HR stay on the anchor so switching period never moves the zones.
 */
export function sportForPeriod(sport: HeartRateSport, startMs: number | null): HeartRateSport {
  if (startMs == null) return sport;
  const inPeriod = (start: string) => new Date(start).getTime() >= startMs;
  const sessions = sport.sessions.filter((session) => inPeriod(session.start));
  const zoneSeconds = HR_ZONES.map((_, index) =>
    sessions.reduce((sum, session) => sum + (session.zoneSeconds[index] ?? 0), 0),
  );
  return {
    ...sport,
    activityCount: sport.activityStarts.filter(inPeriod).length,
    sampleSeconds: zoneSeconds.reduce((sum, seconds) => sum + seconds, 0),
    zones: sport.zones.map((zone, index) => ({ ...zone, seconds: zoneSeconds[index] ?? 0 })),
    activityStarts: sport.activityStarts.filter(inPeriod),
    sessions,
    efficiency: sport.efficiency.filter((point) => inPeriod(point.start)),
  };
}

export function overallFromSports(sports: HeartRateSport[]): HeartRateSport {
  const zoneSeconds = new Map<HeartRateZoneId, number>(HR_ZONES.map((zone) => [zone.id, 0]));
  let sampleSeconds = 0;
  let activityCount = 0;
  let peak: HeartRateSport | null = null;
  const sessions: HeartRateSession[] = [];
  for (const sport of sports) {
    activityCount += sport.activityCount;
    sessions.push(...sport.sessions);
    sampleSeconds += sport.sampleSeconds;
    for (const zone of sport.zones) {
      zoneSeconds.set(zone.id, (zoneSeconds.get(zone.id) ?? 0) + zone.seconds);
    }
    if (sport.maxHeartrate == null) continue;
    if (
      !peak ||
      sport.maxHeartrate > (peak.maxHeartrate ?? 0) ||
      (sport.maxHeartrate === peak.maxHeartrate &&
        (sport.peakActivityStart ?? "") > (peak.peakActivityStart ?? ""))
    ) {
      peak = sport;
    }
  }
  return {
    sportType: ALL_SPORTS,
    members: [],
    family: null,
    zoneModel: "Each sport uses its own zone model",
    zoneMethod: null,
    maxHeartrate: peak?.maxHeartrate ?? null,
    maxAnchor: null,
    lthr: null,
    lthrSource: null,
    restHr: null,
    customZones: null,
    activityCount,
    sampleSeconds,
    peakActivityName: peak?.peakActivityName ?? null,
    peakActivityStart: peak?.peakActivityStart ?? null,
    zones: HR_ZONES.map((zone) => ({
      id: zone.id,
      minBpm: null,
      maxBpm: null,
      seconds: zoneSeconds.get(zone.id) ?? 0,
    })),
    activityStarts: [],
    sessions: sessions.sort((a, b) => a.start.localeCompare(b.start)),
    efficiencyKind: null,
    efficiency: [],
  };
}

export function sortHeartRateSports(sports: HeartRateSport[]) {
  return [...sports].sort((a, b) =>
    formatSportType(a.sportType).localeCompare(formatSportType(b.sportType)),
  );
}

export function mergeSportBuckets(buckets: SportBucket[], canonicalType: string): SportBucket {
  const merged = createSportBucket(canonicalType);
  for (const bucket of buckets) {
    merged.activityCount += bucket.activityCount;
    merged.peaks.push(...bucket.peaks);
    merged.activityStarts.push(...bucket.activityStarts);
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 1) {
      merged.histogram[bpm] += bucket.histogram[bpm] ?? 0;
    }
    if (bucket.maxHeartrate < merged.maxHeartrate) continue;
    if (
      bucket.maxHeartrate === merged.maxHeartrate &&
      merged.peakActivityStart &&
      (bucket.peakActivityStart ?? "") < merged.peakActivityStart
    ) {
      continue;
    }
    merged.maxHeartrate = bucket.maxHeartrate;
    merged.peakActivityName = bucket.peakActivityName;
    merged.peakActivityStart = bucket.peakActivityStart;
  }
  return merged;
}

export function collapseSportBuckets(
  buckets: Map<string, SportBucket>,
  shares: Record<string, boolean> | null | undefined,
  isVisible: (sportType: string) => boolean,
  athlete?: AthleteHeartRate,
  options: { age?: number | null; now?: Date } = {},
): HeartRateSport[] {
  const remaining = new Map(buckets);
  const sports: HeartRateSport[] = [];

  for (const group of SPORT_GROUPS) {
    if (!sharesGroupData(shares, group.id)) continue;
    const members = group.members.filter((member) => remaining.has(member) && isVisible(member));
    if (members.length < 2) continue;
    const merged = mergeSportBuckets(
      members.map((member) => remaining.get(member)!),
      group.canonical,
    );
    const sport = toHeartRateSport(merged, athlete, options);
    sport.members = members;
    sports.push(sport);
    for (const member of members) remaining.delete(member);
  }

  for (const bucket of remaining.values()) {
    if (!isVisible(bucket.sportType)) continue;
    sports.push(toHeartRateSport(bucket, athlete, options));
  }

  return sortHeartRateSports(sports.filter((sport) => sport.activityCount > 0));
}

export function formatHmm(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatZoneBpm(zone: HeartRateZoneStat, isLast: boolean) {
  if (zone.minBpm == null || zone.maxBpm == null) return "per sport";
  if (isLast) return `${zone.minBpm}+ bpm`;
  if (zone.minBpm <= 0) return `≤${zone.maxBpm} bpm`;
  return `${zone.minBpm}–${zone.maxBpm} bpm`;
}

export function lthrHint(sport: HeartRateSport) {
  if (!sport.family) return "varies by sport";
  if (!sport.lthr) return undefined;
  if (sport.lthrSource === "athlete") return "Set by you";
  const model = ZONE_MODELS[sport.family];
  const pct = Math.round(model.lthrFactor * 100);
  if (model.anchor === "lthr") return `${pct}% of ${sport.family} max`;
  return `${pct}% of max HR`;
}

export function lthrInfo(sport: HeartRateSport) {
  if (!sport.family) {
    return "Lactate threshold is sport-specific. Open a sport to see its estimate. All time in zone is classified with that sport's own model, not one global max HR.";
  }
  const model = ZONE_MODELS[sport.family];
  const pct = Math.round(model.lthrFactor * 100);
  if (sport.lthrSource === "athlete") {
    return "Lactate threshold you set in settings. It scores heart-rate training load, and cuts zones when this sport uses % of LTHR.";
  }
  if (model.anchor === "lthr") {
    return `Estimated lactate threshold as ${pct}% of this sport's max heart rate. Cycling, running, and swimming use different % of LTHR cuts.`;
  }
  return `Walking and mixed sports use % of max HR for zones. LTHR is shown as ${pct}% of max for reference only.`;
}

export const loadHeartRate = createServerFn({ method: "GET" }).handler(
  async (): Promise<HeartRateData> => {
    const { loadHeartRateImpl } = await import("./heart-rate.server.ts");
    return loadHeartRateImpl();
  },
);
