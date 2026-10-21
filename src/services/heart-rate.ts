import { createServerFn } from "@tanstack/react-start";

import { formatSportType, type CalendarSettings } from "./calendar-settings.types.ts";
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
    color: "var(--color-ds-teal-700)",
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

export type HeartRateLthrSource = "estimated-from-max";

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
  /** Zone anchor: recent max HR without spikes, or the age prediction. */
  maxHeartrate: number | null;
  maxAnchor: MaxHrAnchor | null;
  lthr: number | null;
  lthrSource: HeartRateLthrSource | null;
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

export type SportLthrAnchors = Partial<
  Record<
    Exclude<HeartRateFamily, "walking" | "other">,
    { bpm: number; source: HeartRateLthrSource }
  >
>;

export type HeartRateData = {
  signedIn: boolean;
  overall: HeartRateSport;
  sports: HeartRateSport[];
  sportTypes: CalendarSettings["sportTypes"];
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

function zoneBounds(model: ZoneModel, lthr: number | null, maxHeartrate: number) {
  const anchor = model.anchor === "lthr" && lthr ? lthr : maxHeartrate;
  if (anchor <= 0) return [];
  return model.bands.map((band, index) => {
    const previous = model.bands[index - 1];
    const minBpm = index === 0 ? 0 : pctBpm(anchor, previous.toPct ?? 1) + 1;
    const maxBpm = band.toPct == null ? BPM_MAX : pctBpm(anchor, band.toPct);
    return { id: band.id, minBpm, maxBpm: Math.max(minBpm, maxBpm) };
  });
}

export function zonesFromHistogram(
  histogram: number[],
  sportType: string,
  maxHeartrate: number | null,
  lthr: number | null,
): HeartRateZoneStat[] {
  const model = zoneModelFor(sportType);
  const peak = maxHeartrate ?? histogramMaxBpm(histogram) ?? 0;
  const bounds = zoneBounds(model, lthr, peak);
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

export function familyLthr(
  family: HeartRateFamily,
  maxHeartrate: number | null,
  anchors: SportLthrAnchors | undefined,
) {
  if (family === "walking" || family === "other") {
    return { lthr: estimateLthrFromMax(maxHeartrate, family), source: null };
  }
  const stored = anchors?.[family];
  if (stored?.bpm) return { lthr: stored.bpm, source: stored.source };
  const estimated = estimateLthrFromMax(maxHeartrate, family);
  return { lthr: estimated, source: estimated ? ("estimated-from-max" as const) : null };
}

export function toHeartRateSport(
  bucket: SportBucket,
  anchors?: SportLthrAnchors,
  options: { age?: number | null; now?: Date } = {},
): HeartRateSport {
  const family = heartRateFamily(bucket.sportType);
  const model = ZONE_MODELS[family];
  const peaks = bucket.peaks.length
    ? bucket.peaks
    : bucket.maxHeartrate > 0 && bucket.peakActivityStart
      ? [{ bpm: bucket.maxHeartrate, start: bucket.peakActivityStart }]
      : [];
  const maxAnchor = estimateMaxHrAnchor(peaks, { family, age: options.age, now: options.now });
  const maxHeartrate = maxAnchor.bpm ?? histogramMaxBpm(bucket.histogram);
  const { lthr, source } = familyLthr(family, maxHeartrate, anchors);
  return {
    sportType: bucket.sportType,
    members: [bucket.sportType],
    family,
    zoneModel: model.label,
    maxHeartrate,
    maxAnchor,
    lthr,
    lthrSource: source,
    activityCount: bucket.activityCount,
    sampleSeconds: histogramSeconds(bucket.histogram),
    peakActivityName: maxAnchor.peak?.name ?? null,
    peakActivityStart: maxAnchor.peak?.start ?? null,
    zones: zonesFromHistogram(bucket.histogram, bucket.sportType, maxHeartrate, lthr),
    activityStarts: bucket.activityStarts,
    sessions: [],
    efficiencyKind: null,
    efficiency: [],
  };
}

/** Adds one activity's samples to a sport whose zone bounds are already set. */
export function addSessionToSport(sport: HeartRateSport, start: string, histogram: number[]) {
  const zones = zonesFromHistogram(histogram, sport.sportType, sport.maxHeartrate, sport.lthr);
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
    maxHeartrate: peak?.maxHeartrate ?? null,
    maxAnchor: null,
    lthr: null,
    lthrSource: null,
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
  anchors?: SportLthrAnchors,
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
    const sport = toHeartRateSport(merged, anchors, options);
    sport.members = members;
    sports.push(sport);
    for (const member of members) remaining.delete(member);
  }

  for (const bucket of remaining.values()) {
    if (!isVisible(bucket.sportType)) continue;
    sports.push(toHeartRateSport(bucket, anchors, options));
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
