import {
  formatBpm,
  formatDuration,
  formatElevation,
  formatSpeed,
} from "./activity-detail.types.ts";
import { formatSportType } from "./calendar-settings.types.ts";
import {
  emptyHistogram,
  estimateLthrFromMax,
  heartRateFamily,
  HR_ZONES,
  zonesFromHistogram,
  type HeartRateFamily,
} from "./heart-rate.ts";
import { sportGroupFor } from "./sport-groups.ts";

export const ANALYSIS_STREAMS = [
  "heartrate",
  "watts",
  "cadence",
  "speed",
  "altitude",
  "grade",
] as const;

export type AnalysisStreamKey = (typeof ANALYSIS_STREAMS)[number];

export type ActivitySample = {
  t: number;
  distanceM: number | null;
  altitudeM: number | null;
  gradePct: number | null;
  heartrate: number | null;
  watts: number | null;
  speedKmh: number | null;
  cadence: number | null;
};

export type TerrainKind = "climb" | "descent" | "flat";

export type TerrainSegment = {
  kind: TerrainKind;
  startSec: number;
  endSec: number;
  durationSec: number;
  distanceM: number | null;
  elevationDeltaM: number;
  avgGradePct: number | null;
  avgHeartrate: number | null;
  heartrateRise: number | null;
  avgSpeedKmh: number | null;
  avgWatts: number | null;
  likelyHike: boolean;
};

export type StreamCorrelation = {
  x: AnalysisStreamKey;
  y: AnalysisStreamKey;
  n: number;
  r: number | null;
  lagSec: number;
  strength: "strong" | "moderate" | "weak" | "none";
  coachRelevant: boolean;
  note: string;
};

export type SessionThird = {
  part: 1 | 2 | 3;
  durationSec: number;
  avgHeartrate: number | null;
  avgSpeedKmh: number | null;
};

export type ZoneShare = {
  id: string;
  name: string;
  seconds: number;
  sharePct: number;
  minBpm: number | null;
  maxBpm: number | null;
};

export type GradeBucket = {
  label: string;
  minGrade: number;
  maxGrade: number;
  durationSec: number;
  avgHeartrate: number | null;
  avgSpeedKmh: number | null;
  avgWatts: number | null;
};

export type EffortPhase = {
  kind: "surge" | "recovery" | "steady";
  startSec: number;
  endSec: number;
  durationSec: number;
  avgHeartrate: number | null;
  onClimb: boolean;
};

export type ActivityOverview = {
  title: string;
  sportType: string;
  sportLabel: string;
  sportFamily: HeartRateFamily;
  movingTimeSec: number;
  distanceM: number | null;
  elevationGainM: number | null;
  available: AnalysisStreamKey[];
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgWatts: number | null;
  avgSpeedKmh: number | null;
  sampleCount: number;
  hasStreams: boolean;
  powerRole: "meter" | "estimated" | "none";
  lthr: number | null;
  lthrSource: "athlete" | "estimated-from-session-max" | null;
  ftp: number | null;
  timeInZones: ZoneShare[];
  aboveThresholdSec: number;
  thirds: SessionThird[];
  hrDriftBpm: number | null;
  speedFadePct: number | null;
  hikeSec: number;
  notes: string[];
};

export type ElevationSegmentsReport = {
  climbs: TerrainSegment[];
  descents: TerrainSegment[];
  climbCount: number;
  otherClimbCount: number;
  hikeClimbCount: number;
  descentCount: number;
  climbGainM: number;
  notes: string[];
};

export type CorrelationReport = {
  pairs: StreamCorrelation[];
  notes: string[];
};

export type EffortReport = {
  phases: EffortPhase[];
  gradeBuckets: GradeBucket[];
  notes: string[];
};

export type ActivityAnalysisSnapshot = {
  overview: ActivityOverview;
  samples: ActivitySample[];
};

export type StoredActivityAnalysis = {
  activityId: string;
  body: string;
  mocked: boolean;
  model: string | null;
  updatedAt: string;
};

export type CoachBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };

export type CoachSection = {
  title: string | null;
  blocks: CoachBlock[];
};

const SECTION_ALIASES: { match: RegExp; title: string }[] = [
  { match: /^takeaway\b/i, title: "Takeaway" },
  { match: /^what to keep/i, title: "What to keep / change" },
  { match: /^watch-?outs?\b/i, title: "Watch-outs" },
];

function canonicalSectionTitle(raw: string) {
  const trimmed = raw.replace(/[:#]+$/g, "").trim();
  const alias = SECTION_ALIASES.find((item) => item.match.test(trimmed));
  return alias?.title ?? trimmed;
}

function flushParagraph(blocks: CoachBlock[], buffer: string[]) {
  const text = buffer.join(" ").trim();
  buffer.length = 0;
  if (text) blocks.push({ type: "p", text });
}

export function parseCoachMarkdown(markdown: string): CoachSection[] {
  const sections: CoachSection[] = [];
  let current: CoachSection = { title: null, blocks: [] };
  const paragraph: string[] = [];

  const startSection = (title: string) => {
    flushParagraph(current.blocks, paragraph);
    if (current.title || current.blocks.length) sections.push(current);
    current = { title, blocks: [] };
  };

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      startSection(canonicalSectionTitle(heading[1]));
      continue;
    }
    const labeled = line.match(
      /^(Takeaway|What to keep(?:\s*\/\s*change)?|Watch-?outs?)\s*:?\s*(.*)$/i,
    );
    if (labeled) {
      startSection(canonicalSectionTitle(labeled[1]));
      if (labeled[2].trim()) paragraph.push(labeled[2].trim());
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph(current.blocks, paragraph);
      const last = current.blocks[current.blocks.length - 1];
      if (last?.type === "ul") last.items.push(bullet[1]);
      else current.blocks.push({ type: "ul", items: [bullet[1]] });
      continue;
    }
    if (!line) {
      flushParagraph(current.blocks, paragraph);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph(current.blocks, paragraph);
  if (current.title || current.blocks.length) sections.push(current);
  return sections.length
    ? sections
    : [{ title: null, blocks: [{ type: "p", text: markdown.trim() }] }];
}

const MAX_SAMPLES = 1400;
const GRADE_CLIMB = 2.5;
const GRADE_DESCENT = -2.5;
const MIN_SEGMENT_SEC = 40;
const MIN_CLIMB_GAIN = 18;
const MERGE_GAP_SEC = 50;
const MAX_DEFINING_CLIMBS = 5;
const HIKE_SPEED_KMH = 5.5;
const HIKE_GRADE_PCT = 8;

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pickIndexes(length: number, maxPoints: number) {
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => Math.round(index * step));
}

function sampleValue(values: number[] | null | undefined, index: number) {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveGrade(samples: ActivitySample[]) {
  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1];
    const next = samples[index];
    if (next.gradePct != null) continue;
    const dAlt =
      next.altitudeM != null && prev.altitudeM != null ? next.altitudeM - prev.altitudeM : null;
    const dDist =
      next.distanceM != null && prev.distanceM != null ? next.distanceM - prev.distanceM : null;
    if (dAlt == null || dDist == null || dDist < 1) continue;
    next.gradePct = Math.round((dAlt / dDist) * 1000) / 10;
  }
}

function smoothGrade(samples: ActivitySample[], window = 7) {
  const half = Math.floor(window / 2);
  const grades = samples.map((sample) => sample.gradePct);
  for (let index = 0; index < samples.length; index += 1) {
    const slice: number[] = [];
    for (let offset = -half; offset <= half; offset += 1) {
      const value = grades[index + offset];
      if (value != null) slice.push(value);
    }
    const smoothed = mean(slice);
    if (smoothed != null) samples[index].gradePct = Math.round(smoothed * 10) / 10;
  }
}

export function buildActivitySamples(input: {
  time: number[] | null;
  distance: number[] | null;
  altitude: number[] | null;
  gradeSmooth: number[] | null;
  heartrate: number[] | null;
  watts: number[] | null;
  velocitySmooth: number[] | null;
  cadence: number[] | null;
}): ActivitySample[] {
  const length = Math.max(
    input.time?.length ?? 0,
    input.distance?.length ?? 0,
    input.altitude?.length ?? 0,
    input.heartrate?.length ?? 0,
    input.watts?.length ?? 0,
    input.velocitySmooth?.length ?? 0,
    input.cadence?.length ?? 0,
    input.gradeSmooth?.length ?? 0,
  );
  if (length === 0) return [];
  const samples = pickIndexes(length, MAX_SAMPLES).map((index) => {
    const speedMs = sampleValue(input.velocitySmooth, index);
    const hr = sampleValue(input.heartrate, index);
    return {
      t: sampleValue(input.time, index) ?? index,
      distanceM: sampleValue(input.distance, index),
      altitudeM: sampleValue(input.altitude, index),
      gradePct: sampleValue(input.gradeSmooth, index),
      heartrate: hr != null && hr > 0 ? Math.round(hr) : null,
      watts: sampleValue(input.watts, index),
      speedKmh: speedMs == null ? null : Math.round(speedMs * 36) / 10,
      cadence: sampleValue(input.cadence, index),
    } satisfies ActivitySample;
  });
  deriveGrade(samples);
  if (!input.gradeSmooth?.length) smoothGrade(samples);
  return samples;
}

function availableStreams(samples: ActivitySample[]): AnalysisStreamKey[] {
  const present = new Set<AnalysisStreamKey>();
  for (const sample of samples) {
    for (const key of ANALYSIS_STREAMS) {
      if (present.has(key)) continue;
      if (sampleValueFor(sample, key) != null) present.add(key);
    }
    if (present.size === ANALYSIS_STREAMS.length) break;
  }
  return ANALYSIS_STREAMS.filter((key) => present.has(key));
}

export function sampleValueFor(sample: ActivitySample, key: AnalysisStreamKey) {
  if (key === "heartrate") return sample.heartrate;
  if (key === "watts") return sample.watts;
  if (key === "cadence") return sample.cadence;
  if (key === "speed") return sample.speedKmh;
  if (key === "altitude") return sample.altitudeM;
  return sample.gradePct;
}

function classifyGrade(grade: number | null): TerrainKind {
  if (grade == null) return "flat";
  if (grade >= GRADE_CLIMB) return "climb";
  if (grade <= GRADE_DESCENT) return "descent";
  return "flat";
}

type IndexedSegment = TerrainSegment & { startIndex: number; endIndex: number };

function isRunningSport(sportType?: string) {
  return sportGroupFor(sportType ?? "")?.id === "running";
}

function isHikeLike(
  segment: Pick<TerrainSegment, "kind" | "avgSpeedKmh" | "avgGradePct">,
  sportType?: string,
) {
  return (
    isRunningSport(sportType) &&
    segment.kind === "climb" &&
    segment.avgSpeedKmh != null &&
    segment.avgSpeedKmh < HIKE_SPEED_KMH &&
    (segment.avgGradePct ?? 0) >= HIKE_GRADE_PCT
  );
}

function segmentStats(
  samples: ActivitySample[],
  start: number,
  end: number,
  sportType?: string,
): IndexedSegment {
  const slice = samples.slice(start, end + 1);
  const first = slice[0];
  const last = slice[end - start];
  const hrs: number[] = [];
  const speeds: number[] = [];
  const watts: number[] = [];
  const grades: number[] = [];
  for (const sample of slice) {
    if (sample.heartrate != null) hrs.push(sample.heartrate);
    if (sample.speedKmh != null) speeds.push(sample.speedKmh);
    if (sample.watts != null && sample.watts > 0) watts.push(sample.watts);
    if (sample.gradePct != null) grades.push(sample.gradePct);
  }
  const lookbackT = first.t - 45;
  const before = samples.filter(
    (sample) => sample.t >= lookbackT && sample.t < first.t && sample.heartrate != null,
  );
  const hrBefore = mean(before.map((sample) => sample.heartrate as number));
  const hrDuring = mean(hrs);
  const kind = classifyGrade(mean(grades));
  const avgSpeedKmh = mean(speeds) == null ? null : Math.round((mean(speeds) as number) * 10) / 10;
  const avgGradePct = mean(grades) == null ? null : Math.round((mean(grades) as number) * 10) / 10;
  return {
    kind,
    startSec: first.t,
    endSec: last.t,
    durationSec: Math.max(0, last.t - first.t),
    distanceM:
      last.distanceM != null && first.distanceM != null ? last.distanceM - first.distanceM : null,
    elevationDeltaM:
      last.altitudeM != null && first.altitudeM != null ? last.altitudeM - first.altitudeM : 0,
    avgGradePct,
    avgHeartrate: hrDuring == null ? null : Math.round(hrDuring),
    heartrateRise: hrDuring != null && hrBefore != null ? Math.round(hrDuring - hrBefore) : null,
    avgSpeedKmh,
    avgWatts: mean(watts) == null ? null : Math.round(mean(watts) as number),
    likelyHike: isHikeLike({ kind, avgSpeedKmh, avgGradePct }, sportType),
    startIndex: start,
    endIndex: end,
  };
}

function mergeNearbyClimbs(raw: IndexedSegment[], samples: ActivitySample[], sportType?: string) {
  const merged: IndexedSegment[] = [];
  let index = 0;
  while (index < raw.length) {
    const current = raw[index];
    if (current.kind !== "climb") {
      merged.push(current);
      index += 1;
      continue;
    }
    let end = index;
    while (
      end + 2 < raw.length &&
      raw[end + 1].kind === "flat" &&
      raw[end + 1].durationSec <= MERGE_GAP_SEC &&
      raw[end + 2].kind === "climb"
    ) {
      end += 2;
    }
    merged.push(
      end === index
        ? current
        : segmentStats(samples, current.startIndex, raw[end].endIndex, sportType),
    );
    index = end + 1;
  }
  return merged;
}

function withoutIndexes(segment: IndexedSegment): TerrainSegment {
  const { startIndex: _start, endIndex: _end, ...rest } = segment;
  return rest;
}

function indexedTerrainSegments(samples: ActivitySample[], sportType?: string) {
  if (!samples.some((sample) => sample.altitudeM != null || sample.gradePct != null)) {
    return [] as IndexedSegment[];
  }
  const raw: IndexedSegment[] = [];
  let start = 0;
  for (let index = 1; index <= samples.length; index += 1) {
    const prevKind = classifyGrade(samples[start].gradePct);
    const kind = index < samples.length ? classifyGrade(samples[index].gradePct) : null;
    if (kind === prevKind) continue;
    const segment = segmentStats(samples, start, index - 1, sportType);
    const keep =
      segment.durationSec >= MIN_SEGMENT_SEC ||
      (segment.kind === "climb" && segment.elevationDeltaM >= MIN_CLIMB_GAIN) ||
      (segment.kind === "descent" && segment.elevationDeltaM <= -MIN_CLIMB_GAIN);
    if (keep) raw.push(segment);
    start = index;
  }
  return mergeNearbyClimbs(raw, samples, sportType);
}

function indexedElevationClimbs(samples: ActivitySample[], sportType?: string) {
  return indexedTerrainSegments(samples, sportType)
    .filter((segment) => segment.kind === "climb")
    .sort((a, b) => b.elevationDeltaM - a.elevationDeltaM);
}

export function detectElevationSegments(
  samples: ActivitySample[],
  sportType?: string,
): ElevationSegmentsReport {
  const notes: string[] = [];
  const merged = indexedTerrainSegments(samples, sportType);
  if (
    !merged.length &&
    !samples.some((sample) => sample.altitudeM != null || sample.gradePct != null)
  ) {
    return {
      climbs: [],
      descents: [],
      climbCount: 0,
      otherClimbCount: 0,
      hikeClimbCount: 0,
      descentCount: 0,
      climbGainM: 0,
      notes: ["No elevation or grade stream."],
    };
  }
  const climbs = merged
    .filter((segment) => segment.kind === "climb")
    .sort((a, b) => b.elevationDeltaM - a.elevationDeltaM)
    .map(withoutIndexes);
  const descents = merged
    .filter((segment) => segment.kind === "descent")
    .sort((a, b) => a.elevationDeltaM - b.elevationDeltaM)
    .map(withoutIndexes);
  const defining = climbs.slice(0, MAX_DEFINING_CLIMBS);
  const hikeClimbCount = climbs.filter((segment) => segment.likelyHike).length;
  if (!climbs.length) notes.push("No sustained climbs detected (grade under 2.5% or too short).");
  else {
    notes.push(
      "Only the defining climbs are listed. Short pitches sit in otherClimbCount — do not narrate every wall.",
    );
    if (isRunningSport(sportType)) {
      notes.push(
        "likelyHike means power-hiking (slow and steep), not an easy climb. Lower HR there is usually a gait change.",
      );
    }
  }
  return {
    climbs: defining,
    descents: descents.slice(0, 4),
    climbCount: climbs.length,
    otherClimbCount: Math.max(0, climbs.length - defining.length),
    hikeClimbCount,
    descentCount: descents.length,
    climbGainM: Math.round(
      climbs.reduce((sum, segment) => sum + Math.max(0, segment.elevationDeltaM), 0),
    ),
    notes,
  };
}

function pearson(xs: number[], ys: number[]) {
  if (xs.length < 20 || xs.length !== ys.length) return null;
  const xMean = mean(xs);
  const yMean = mean(ys);
  if (xMean == null || yMean == null) return null;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - xMean;
    const dy = ys[index] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function strengthFor(r: number | null): StreamCorrelation["strength"] {
  if (r == null) return "none";
  const abs = Math.abs(r);
  if (abs >= 0.6) return "strong";
  if (abs >= 0.35) return "moderate";
  if (abs >= 0.15) return "weak";
  return "none";
}

function correlationNote(
  r: number,
  lagSec: number,
  y: AnalysisStreamKey,
): Pick<StreamCorrelation, "strength" | "coachRelevant" | "note"> {
  const strength = strengthFor(r);
  const coachRelevant = strength === "moderate" || strength === "strong";
  if (!coachRelevant) {
    return {
      strength,
      coachRelevant: false,
      note: "Too weak to coach from. Do not quote this r-value or invent cardiac lag from it.",
    };
  }
  const direction = r >= 0 ? "positive" : "negative";
  const lagNote =
    lagSec >= 15 && lagSec <= 45 && y === "heartrate"
      ? ` Cardiac lag of ${lagSec}s is real here — mention it.`
      : lagSec > 0
        ? ` Best coupling with a ${lagSec}s lag on ${y}.`
        : "";
  return {
    strength,
    coachRelevant: true,
    note: `${strength} ${direction} coupling.${lagNote}`,
  };
}

function correlatePair(
  samples: ActivitySample[],
  x: AnalysisStreamKey,
  y: AnalysisStreamKey,
): StreamCorrelation {
  const lags = y === "heartrate" || x === "heartrate" ? [0, 15, 30, 45, 60] : [0, 15, 30];
  let best: StreamCorrelation = {
    x,
    y,
    n: 0,
    r: null,
    lagSec: 0,
    strength: "none",
    coachRelevant: false,
    note: "Not enough overlapping samples.",
  };
  for (const lagSec of lags) {
    const xs: number[] = [];
    const ys: number[] = [];
    let cursor = 0;
    for (const sample of samples) {
      const xValue = sampleValueFor(sample, x);
      if (xValue == null) continue;
      const targetT = sample.t + lagSec;
      while (cursor < samples.length - 1 && samples[cursor + 1].t <= targetT) cursor += 1;
      const nearest = samples[cursor];
      if (!nearest || Math.abs(nearest.t - targetT) > 8) continue;
      const yValue = sampleValueFor(nearest, y);
      if (yValue == null) continue;
      xs.push(xValue);
      ys.push(yValue);
    }
    const r = pearson(xs, ys);
    if (r == null) continue;
    if (best.r == null || Math.abs(r) > Math.abs(best.r)) {
      best = {
        x,
        y,
        n: xs.length,
        r: Math.round(r * 100) / 100,
        lagSec,
        ...correlationNote(r, lagSec, y),
      };
    }
  }
  return best;
}

function defaultPairs(sportType?: string): [AnalysisStreamKey, AnalysisStreamKey][] {
  const pairs: [AnalysisStreamKey, AnalysisStreamKey][] = [
    ["altitude", "heartrate"],
    ["grade", "heartrate"],
    ["speed", "heartrate"],
    ["grade", "speed"],
  ];
  if (!isRunningSport(sportType)) pairs.push(["grade", "watts"]);
  return pairs;
}

export function correlateStreams(
  samples: ActivitySample[],
  pairs?: [AnalysisStreamKey, AnalysisStreamKey][],
  sportType?: string,
): CorrelationReport {
  const present = new Set(availableStreams(samples));
  const notes: string[] = ["Only pairs with coachRelevant=true belong in the write-up."];
  const usable = (pairs ?? defaultPairs(sportType)).filter(([x, y]) => {
    const ok = present.has(x) && present.has(y);
    if (!ok) notes.push(`Skipped ${x} vs ${y}: missing stream.`);
    return ok;
  });
  return { pairs: usable.map(([x, y]) => correlatePair(samples, x, y)), notes };
}

const GRADE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Steep descent", min: -100, max: -6 },
  { label: "Descent", min: -6, max: -2.5 },
  { label: "Flat / rolling", min: -2.5, max: 2.5 },
  { label: "Climb", min: 2.5, max: 6 },
  { label: "Steep climb", min: 6, max: 12 },
  { label: "Very steep", min: 12, max: 100 },
];

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] * (high - index) + sorted[high] * (index - low);
}

function bandIndexForGrade(grade: number) {
  for (let index = 0; index < GRADE_BANDS.length; index += 1) {
    const band = GRADE_BANDS[index];
    if (grade >= band.min && grade < band.max) return index;
  }
  return -1;
}

export function summarizeEffort(samples: ActivitySample[]): EffortReport {
  const notes: string[] = [];
  const buckets = GRADE_BANDS.map((band) => ({
    label: band.label,
    minGrade: band.min,
    maxGrade: band.max,
    durationSec: 0,
    hrs: [] as number[],
    speeds: [] as number[],
    watts: [] as number[],
  }));
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.gradePct == null) continue;
    const bandIndex = bandIndexForGrade(sample.gradePct);
    if (bandIndex < 0) continue;
    const bucket = buckets[bandIndex];
    const next = samples[index + 1];
    if (next) bucket.durationSec += Math.max(0, next.t - sample.t);
    if (sample.heartrate != null) bucket.hrs.push(sample.heartrate);
    if (sample.speedKmh != null) bucket.speeds.push(sample.speedKmh);
    if (sample.watts != null && sample.watts > 0) bucket.watts.push(sample.watts);
  }
  const gradeBuckets: GradeBucket[] = buckets
    .filter((bucket) => bucket.durationSec >= 20)
    .map((bucket) => ({
      label: bucket.label,
      minGrade: bucket.minGrade,
      maxGrade: bucket.maxGrade,
      durationSec: bucket.durationSec,
      avgHeartrate: mean(bucket.hrs),
      avgSpeedKmh: mean(bucket.speeds),
      avgWatts: mean(bucket.watts),
    }));

  const hrs = samples
    .map((sample) => sample.heartrate)
    .filter((value): value is number => value != null);
  if (hrs.length < 30) {
    notes.push("Not enough heart-rate samples to split surges from recoveries.");
    return { phases: [], gradeBuckets, notes };
  }
  const high = percentile(hrs, 0.75) ?? 0;
  const low = percentile(hrs, 0.4) ?? 0;
  const climbTimes = new Set<number>();
  for (const segment of indexedElevationClimbs(samples)) {
    for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
      climbTimes.add(samples[index].t);
    }
  }
  const phases: EffortPhase[] = [];
  let start = 0;
  const kindAt = (index: number): EffortPhase["kind"] => {
    const hr = samples[index].heartrate;
    if (hr == null) return "steady";
    if (hr >= high) return "surge";
    if (hr <= low) return "recovery";
    return "steady";
  };
  for (let index = 1; index <= samples.length; index += 1) {
    const prev = kindAt(start);
    const next = index < samples.length ? kindAt(index) : null;
    if (next === prev) continue;
    const slice = samples.slice(start, index);
    const durationSec = slice[slice.length - 1].t - slice[0].t;
    if (durationSec >= 20 && prev !== "steady") {
      phases.push({
        kind: prev,
        startSec: slice[0].t,
        endSec: slice[slice.length - 1].t,
        durationSec,
        avgHeartrate: mean(
          slice.map((sample) => sample.heartrate).filter((value): value is number => value != null),
        ),
        onClimb: slice.some((sample) => climbTimes.has(sample.t)),
      });
    }
    start = index;
  }
  return {
    phases: phases.slice(0, 12),
    gradeBuckets: gradeBuckets.map((bucket) => ({
      ...bucket,
      avgHeartrate: bucket.avgHeartrate == null ? null : Math.round(bucket.avgHeartrate),
      avgSpeedKmh: bucket.avgSpeedKmh == null ? null : Math.round(bucket.avgSpeedKmh * 10) / 10,
      avgWatts: bucket.avgWatts == null ? null : Math.round(bucket.avgWatts),
    })),
    notes,
  };
}

function sampleDeltaSec(samples: ActivitySample[], index: number) {
  const current = samples[index];
  const next = samples[index + 1];
  if (!current || !next) return 1;
  return Math.max(0, Math.min(30, next.t - current.t));
}

function sessionThirds(samples: ActivitySample[]): SessionThird[] {
  if (samples.length < 6) return [];
  const start = samples[0].t;
  const end = samples[samples.length - 1].t;
  const span = Math.max(1, end - start);
  return ([1, 2, 3] as const).map((part) => {
    const from = start + ((part - 1) / 3) * span;
    const to = start + (part / 3) * span;
    const slice = samples.filter((sample) => sample.t >= from && sample.t <= to);
    const hrs = slice
      .map((sample) => sample.heartrate)
      .filter((value): value is number => value != null);
    const speeds = slice
      .map((sample) => sample.speedKmh)
      .filter((value): value is number => value != null);
    return {
      part,
      durationSec: Math.max(0, Math.round(to - from)),
      avgHeartrate: mean(hrs) == null ? null : Math.round(mean(hrs) as number),
      avgSpeedKmh: mean(speeds) == null ? null : Math.round((mean(speeds) as number) * 10) / 10,
    };
  });
}

function hikeSeconds(samples: ActivitySample[], sportType: string) {
  if (!isRunningSport(sportType)) return 0;
  let seconds = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.speedKmh == null || sample.gradePct == null) continue;
    if (sample.speedKmh < HIKE_SPEED_KMH && sample.gradePct >= HIKE_GRADE_PCT) {
      seconds += sampleDeltaSec(samples, index);
    }
  }
  return Math.round(seconds);
}

function powerRoleFor(sportType: string, hasWatts: boolean): ActivityOverview["powerRole"] {
  if (!hasWatts) return "none";
  const group = sportGroupFor(sportType)?.id;
  if (group === "cycling") return "meter";
  if (group === "running") return "estimated";
  return "estimated";
}

function zoneSharesFromSamples(
  samples: ActivitySample[],
  sportType: string,
  maxHeartrate: number | null,
  lthr: number | null,
): ZoneShare[] {
  const histogram = emptyHistogram();
  const time = samples.map((sample) => sample.t);
  for (let index = 0; index < samples.length; index += 1) {
    const bpm = Math.round(samples[index].heartrate ?? 0);
    if (bpm < 40 || bpm > 230) continue;
    const current = time[index];
    const previous = index > 0 ? time[index - 1] : undefined;
    const delta =
      current != null && previous != null ? Math.max(0, Math.min(30, current - previous)) : 1;
    histogram[bpm] += delta > 0 ? delta : 1;
  }
  const zones = zonesFromHistogram(histogram, sportType, maxHeartrate, lthr);
  const total = zones.reduce((sum, zone) => sum + zone.seconds, 0);
  if (total <= 0) return [];
  return zones
    .filter((zone) => zone.seconds > 0)
    .map((zone) => {
      const meta = HR_ZONES.find((item) => item.id === zone.id);
      return {
        id: zone.id,
        name: meta?.name ?? zone.id,
        seconds: zone.seconds,
        sharePct: Math.round((zone.seconds / total) * 100),
        minBpm: zone.minBpm,
        maxBpm: zone.maxBpm,
      };
    });
}

export function buildOverview(input: {
  title: string;
  sportType: string;
  movingTime: number;
  distance: number | null;
  totalElevationGain: number | null;
  samples: ActivitySample[];
  athlete?: {
    ftp: number | null;
    cyclingLthr: number | null;
    runLthr: number | null;
    swimLthr: number | null;
  };
}): ActivityOverview {
  const samples = input.samples;
  const family = heartRateFamily(input.sportType);
  const hrs = samples
    .map((sample) => sample.heartrate)
    .filter((value): value is number => value != null);
  const watts = samples
    .map((sample) => sample.watts)
    .filter((value): value is number => value != null && value > 0);
  const speeds = samples
    .map((sample) => sample.speedKmh)
    .filter((value): value is number => value != null);
  const maxHeartrate = hrs.length ? Math.max(...hrs) : null;
  const estimatedLthr = estimateLthrFromMax(maxHeartrate, family);
  const storedLthr =
    family === "cycling"
      ? (input.athlete?.cyclingLthr ?? null)
      : family === "running"
        ? (input.athlete?.runLthr ?? null)
        : family === "swimming"
          ? (input.athlete?.swimLthr ?? null)
          : null;
  const lthr = storedLthr ?? estimatedLthr;
  const lthrSource = storedLthr ? "athlete" : estimatedLthr ? "estimated-from-session-max" : null;
  const timeInZones = zoneSharesFromSamples(samples, input.sportType, maxHeartrate, lthr);
  const aboveThresholdSec = timeInZones
    .filter((zone) => zone.id === "z4" || zone.id === "z5")
    .reduce((sum, zone) => sum + zone.seconds, 0);
  const thirds = sessionThirds(samples);
  const first = thirds[0];
  const last = thirds[2];
  const powerRole = powerRoleFor(input.sportType, watts.length > 0);
  const notes: string[] = [];
  if (!samples.length) notes.push("No stream samples are stored for this activity.");
  if (powerRole === "estimated") {
    notes.push("Run power is a watch/Strava estimate. Do not coach it like a bike power meter.");
  }
  if (lthr) {
    notes.push(
      `Coach against ${lthr} bpm LTHR (${lthrSource === "athlete" ? "athlete profile" : "estimated from this session's max"}).`,
    );
  }
  return {
    title: input.title,
    sportType: input.sportType,
    sportLabel: formatSportType(input.sportType),
    sportFamily: family,
    movingTimeSec: input.movingTime,
    distanceM: input.distance,
    elevationGainM: input.totalElevationGain,
    available: availableStreams(samples),
    avgHeartrate: mean(hrs) == null ? null : Math.round(mean(hrs) as number),
    maxHeartrate,
    avgWatts: mean(watts) == null ? null : Math.round(mean(watts) as number),
    avgSpeedKmh: mean(speeds) == null ? null : Math.round((mean(speeds) as number) * 10) / 10,
    sampleCount: samples.length,
    hasStreams: samples.length > 0,
    powerRole,
    lthr,
    lthrSource,
    ftp: input.athlete?.ftp ?? null,
    timeInZones,
    aboveThresholdSec,
    thirds,
    hrDriftBpm:
      first?.avgHeartrate != null && last?.avgHeartrate != null
        ? last.avgHeartrate - first.avgHeartrate
        : null,
    speedFadePct:
      first?.avgSpeedKmh && last?.avgSpeedKmh != null
        ? Math.round(((last.avgSpeedKmh - first.avgSpeedKmh) / first.avgSpeedKmh) * 100)
        : null,
    hikeSec: hikeSeconds(samples, input.sportType),
    notes,
  };
}

function fmtHrDelta(value: number | null) {
  if (value == null) return "n/a";
  const abs = Math.abs(Math.round(value));
  return `${value >= 0 ? "+" : "−"}${abs} bpm vs the 45s before`;
}

function zoneLine(overview: ActivityOverview) {
  if (!overview.timeInZones.length) return null;
  const parts = overview.timeInZones.map((zone) => `${zone.sharePct}% ${zone.name}`);
  const threshold = overview.lthr
    ? ` About ${formatDuration(overview.aboveThresholdSec)} sat at or above threshold (${overview.lthr} bpm LTHR).`
    : "";
  return `Heart rate spent ${parts.join(", ")}.${threshold}`;
}

export function composeMockAnalysis(results: {
  overview?: ActivityOverview;
  elevation?: ElevationSegmentsReport;
  correlations?: CorrelationReport;
  effort?: EffortReport;
}) {
  const overview = results.overview;
  if (!overview?.hasStreams) {
    return "There is not enough stream data on this activity to analyze elevation, heart rate, or pacing. Sync streams first, then run analysis again.";
  }
  const lines: string[] = [];
  const climb = results.elevation?.climbs[0];
  const hikeClimb = results.elevation?.climbs.find((segment) => segment.likelyHike);
  const relevant = results.correlations?.pairs.find((pair) => pair.coachRelevant);
  const surges = results.effort?.phases.filter((phase) => phase.kind === "surge") ?? [];
  const earlySurge = surges.find(
    (phase) => !phase.onClimb && phase.startSec < overview.movingTimeSec * 0.35,
  );

  const intensity =
    overview.lthr && overview.avgHeartrate
      ? overview.avgHeartrate >= overview.lthr
        ? "at or above threshold on average"
        : `around ${Math.round((overview.avgHeartrate / overview.lthr) * 100)}% of threshold`
      : overview.avgHeartrate
        ? `${formatBpm(overview.avgHeartrate)} average`
        : "without heart rate";

  lines.push("## Takeaway");
  lines.push(
    `${overview.sportLabel} for ${formatDuration(overview.movingTimeSec)} sat ${intensity}${overview.hikeSec ? `, with about ${formatDuration(overview.hikeSec)} of power-hiking` : ""}${climb ? `. The defining climb was ${formatElevation(climb.elevationDeltaM)} at ~${climb.avgGradePct ?? "?"}%` : ""}.`,
  );
  const zones = zoneLine(overview);
  if (zones) lines.push(zones);
  lines.push("");

  lines.push("## What to keep / change");
  if (overview.speedFadePct != null && overview.speedFadePct <= -8) {
    lines.push(
      `- Pace faded ${Math.abs(overview.speedFadePct)}% from the first third to the last${overview.hrDriftBpm != null ? ` while HR ${overview.hrDriftBpm >= 0 ? "rose" : "fell"} ${Math.abs(overview.hrDriftBpm)} bpm` : ""}. Start the next similar outing a touch easier.`,
    );
  } else if (earlySurge) {
    lines.push(
      `- An early surge averaged ${formatBpm(earlySurge.avgHeartrate)} off a climb. That is excitement, not terrain — sit on it for the first 20 minutes next time.`,
    );
  }
  if (hikeClimb) {
    lines.push(
      `- On the steepest pitches you hiked (~${formatSpeed(hikeClimb.avgSpeedKmh)} at ${hikeClimb.avgGradePct}%). Treat that as the efficient choice, not a failed run. Plan hike breaks on walls this steep instead of forcing a shuffle.`,
    );
  } else if (climb) {
    lines.push(
      `- Biggest climb: ${formatDuration(climb.durationSec)} at ~${climb.avgGradePct ?? "?"}% (${formatElevation(climb.elevationDeltaM)}), HR ${formatBpm(climb.avgHeartrate)} (${fmtHrDelta(climb.heartrateRise)}), ${formatSpeed(climb.avgSpeedKmh)}.`,
    );
  }
  if ((results.elevation?.otherClimbCount ?? 0) > 0) {
    lines.push(
      `- The course was punchy (${results.elevation?.climbCount} climbs, ${results.elevation?.otherClimbCount} smaller pitches). Save a gear for the later walls rather than racing every bump.`,
    );
  }
  if (relevant?.r != null) {
    lines.push(
      `- ${relevant.x} and ${relevant.y} actually moved together (${relevant.strength}${relevant.lagSec >= 15 && relevant.lagSec <= 45 && relevant.y === "heartrate" ? `, ${relevant.lagSec}s cardiac lag` : ""}).`,
    );
  }
  if (lines[lines.length - 1] === "## What to keep / change") {
    lines.push(
      "- Terrain set the pace more than a single intensity mistake. Keep judging effort from grade, speed, and how you felt together.",
    );
  }
  lines.push("");

  lines.push("## Watch-outs");
  if (
    overview.aboveThresholdSec > overview.movingTimeSec * 0.25 &&
    overview.movingTimeSec > 45 * 60
  ) {
    lines.push(
      `- A long session spent ${formatDuration(overview.aboveThresholdSec)} at or above threshold. That is a lot of redline for the duration — next time cap the early surges.`,
    );
  } else if (overview.maxHeartrate && overview.lthr && overview.maxHeartrate > overview.lthr + 20) {
    lines.push(
      `- Peak ${formatBpm(overview.maxHeartrate)} is well above threshold. Fine as a spike, not as a repeating pattern on a long trail day.`,
    );
  } else if (!overview.avgHeartrate) {
    lines.push("- Without heart rate this is a terrain and speed read only.");
  } else {
    lines.push(
      "- Nothing here looks like a red flag. Use the steep pitches as planned hike/run transitions rather than HR tests.",
    );
  }

  return lines.join("\n");
}

export const ANALYSIS_SYSTEM_PROMPT = `You are this athlete's endurance coach reviewing one finished session. Write for them, not for a sports scientist.

Always call tools first. Never invent numbers. Prefer:
1. get_activity_overview
2. detect_elevation_segments
3. correlate_streams
4. summarize_effort_phases

Use athlete anchors from overview (LTHR, max HR, FTP, timeInZones). Compare average and peak HR to those zones. Say how much time was at or above threshold.

Sport rules:
- Running and trail: coach from pace, HR, grade, and hike vs run. If powerRole is "estimated", ignore watts — never tell a run-power story.
- Cycling: power can lead when powerRole is "meter".
- likelyHike (slow and steep) is power-hiking. Do not call it easy because HR was lower. Lower HR plus much slower speed on a wall is a gait change.

Climbs: discuss only the defining climbs the tool returns. If otherClimbCount is high, say the course was punchy — do not list every pitch or 25%+ GPS spike.

Correlations: cite a pair only if coachRelevant is true. Weak r is noise. Do not quote Pearson coefficients. Mention cardiac lag only when HR coupling is moderate or strong and lag is 15–45s.

Pacing: use overview thirds, hrDriftBpm, and speedFadePct. Early HR surges that are not onClimb are excitement or crowding, not elevation.

Write markdown with these headings exactly (no tables, no r-value lecture):
## Takeaway
One paragraph: intensity vs their zones, hike/run mix if trail, whether it was well paced.

## What to keep / change
2–4 bullets starting with "- " for the next similar outing. Ground each in the data.

## Watch-outs
At most two bullets starting with "- " (too much Z4/Z5, early surges, late fade).

Do not dump every tool field. Do not lead with statistics. If a stream is missing, say so and work with what remains.`;
