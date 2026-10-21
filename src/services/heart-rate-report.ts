import { HR_ZONES, type HeartRateSession } from "./heart-rate.ts";
import type { FitnessPeriod } from "./training-load.ts";
import { addDayKey, dayKey, weekStartKey } from "./training-plan.types.ts";

export type ReportBucketSize = "day" | "week" | "month";

export type HeartRateReportBucket = {
  /** `YYYY-MM-DD` for days and weeks (week start), `YYYY-MM` for months. */
  key: string;
  /** Same order as `HR_ZONES`. */
  zoneSeconds: number[];
  seconds: number;
  sessions: number;
  avgBpm: number | null;
};

/** Share of time in three intensity bands, from the five sport zones. */
export type IntensitySplit = { low: number; moderate: number; high: number };

export type HeartRateReport = {
  size: ReportBucketSize;
  buckets: HeartRateReportBucket[];
  sessions: number;
  seconds: number;
  /** Total time spread over the length of the period, so empty weeks count. */
  weeklySeconds: number;
  avgBpm: number | null;
  intensity: IntensitySplit | null;
};

const DAY_MS = 86_400_000;

/** Enough bars to read on a phone: days for a week, weeks up to six months, then months. */
export function reportBucketSize(period: FitnessPeriod): ReportBucketSize {
  if (period === "7d") return "day";
  return period === "1y" || period === "all" ? "month" : "week";
}

function bucketKey(date: Date, size: ReportBucketSize, timeZone: string) {
  if (size === "day") return dayKey(date, timeZone);
  if (size === "week") return weekStartKey(date, timeZone);
  return dayKey(date, timeZone).slice(0, 7);
}

function nextKey(key: string, size: ReportBucketSize) {
  if (size === "day") return addDayKey(key, 1);
  if (size === "week") return addDayKey(key, 7);
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Zone 1–2 is easy, zone 3 is the middle, zones 4–5 are hard: the usual three-zone reading
 * behind 80/20 training, applied to each sport's own zones.
 */
export function intensitySplit(zoneSeconds: number[]): IntensitySplit | null {
  const [z1 = 0, z2 = 0, z3 = 0, z4 = 0, z5 = 0] = zoneSeconds;
  const total = z1 + z2 + z3 + z4 + z5;
  if (total <= 0) return null;
  return { low: (z1 + z2) / total, moderate: z3 / total, high: (z4 + z5) / total };
}

/** Time in zone, sessions, and average heart rate per day, week, or month of the period. */
export function buildHeartRateReport(
  sessions: HeartRateSession[],
  options: { size: ReportBucketSize; timeZone: string; startMs: number | null; now?: Date },
): HeartRateReport {
  const { size, timeZone } = options;
  const now = options.now ?? new Date();
  const withTime = sessions.filter((session) => session.zoneSeconds.some((seconds) => seconds > 0));
  const firstMs = withTime.reduce(
    (min, session) => Math.min(min, new Date(session.start).getTime()),
    Infinity,
  );
  const startMs = options.startMs ?? (Number.isFinite(firstMs) ? firstMs : null);
  const empty = {
    size,
    buckets: [],
    sessions: 0,
    seconds: 0,
    weeklySeconds: 0,
    avgBpm: null,
    intensity: null,
  };
  if (startMs == null) return empty;

  const buckets = new Map<string, HeartRateReportBucket & { bpmSum: number; bpmSeconds: number }>();
  const lastKey = bucketKey(now, size, timeZone);
  for (let key = bucketKey(new Date(startMs), size, timeZone); key <= lastKey;) {
    buckets.set(key, {
      key,
      zoneSeconds: HR_ZONES.map(() => 0),
      seconds: 0,
      sessions: 0,
      avgBpm: null,
      bpmSum: 0,
      bpmSeconds: 0,
    });
    key = nextKey(key, size);
  }

  for (const session of withTime) {
    const bucket = buckets.get(bucketKey(new Date(session.start), size, timeZone));
    if (!bucket) continue;
    const seconds = session.zoneSeconds.reduce((sum, value) => sum + value, 0);
    bucket.sessions += 1;
    bucket.seconds += seconds;
    session.zoneSeconds.forEach((value, index) => {
      bucket.zoneSeconds[index] = (bucket.zoneSeconds[index] ?? 0) + value;
    });
    if (session.avgBpm != null) {
      bucket.bpmSum += session.avgBpm * seconds;
      bucket.bpmSeconds += seconds;
    }
  }

  const list = [...buckets.values()];
  let bpmSum = 0;
  let bpmSeconds = 0;
  for (const bucket of list) {
    bpmSum += bucket.bpmSum;
    bpmSeconds += bucket.bpmSeconds;
  }
  const zoneSeconds = HR_ZONES.map((_, index) =>
    list.reduce((sum, bucket) => sum + (bucket.zoneSeconds[index] ?? 0), 0),
  );
  const seconds = zoneSeconds.reduce((sum, value) => sum + value, 0);
  const weeks = Math.max(1, (now.getTime() - startMs) / DAY_MS / 7);
  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    size,
    buckets: list.map(({ bpmSum: sum, bpmSeconds: weight, ...bucket }) => ({
      ...bucket,
      avgBpm: weight > 0 ? round(sum / weight) : null,
    })),
    sessions: list.reduce((sum, bucket) => sum + bucket.sessions, 0),
    seconds,
    weeklySeconds: Math.round(seconds / weeks),
    avgBpm: bpmSeconds > 0 ? round(bpmSum / bpmSeconds) : null,
    intensity: intensitySplit(zoneSeconds),
  };
}
