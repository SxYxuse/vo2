import { z } from "zod";

import {
  BPM_MAX,
  BPM_MIN,
  ZONED_FAMILIES,
  resolveHeartRate,
  type AthleteHeartRate,
  type ZoneMethod,
  type ZonedFamily,
} from "./heart-rate.ts";

export const ZONED_FAMILY_LABELS: Record<ZonedFamily, string> = {
  cycling: "Cycling",
  running: "Running",
  swimming: "Swimming",
};

export const ZONE_METHODS: { id: ZoneMethod; label: string; hint: string }[] = [
  {
    id: "lthr",
    label: "% of LTHR",
    hint: "Friel for running, Coggan for cycling, CSS-style for swimming.",
  },
  { id: "max", label: "% of max heart rate", hint: "60, 70, 80, and 90 % of max." },
  {
    id: "reserve",
    label: "Heart-rate reserve",
    hint: "Karvonen: 60, 70, 80, and 90 % of the range from resting to max.",
  },
  { id: "custom", label: "Custom", hint: "Your own zones, in bpm." },
];

export const REST_HR_MIN = 30;
export const REST_HR_MAX = 100;

const bpm = z.number().int().min(BPM_MIN).max(BPM_MAX);

const sportHeartRateSchema = z.object({
  method: z.enum(["lthr", "max", "reserve", "custom"]).default("lthr"),
  lthr: bpm.nullable().default(null),
  maxHr: bpm.nullable().default(null),
  /** Tops of zones 1 to 4. Kept when switching away from custom so switching back restores them. */
  customZones: z.array(bpm).length(4).nullable().default(null),
});

export const heartRateSettingsSchema = z.object({
  restHr: z.number().int().min(REST_HR_MIN).max(REST_HR_MAX).nullable().default(null),
  sports: z
    .object({
      cycling: sportHeartRateSchema.prefault({}),
      running: sportHeartRateSchema.prefault({}),
      swimming: sportHeartRateSchema.prefault({}),
    })
    .prefault({}),
});

export type HeartRateSettings = z.output<typeof heartRateSettingsSchema>;
export type SportHeartRateSettings = HeartRateSettings["sports"][ZonedFamily];

export const DEFAULT_HEART_RATE_SETTINGS: HeartRateSettings = heartRateSettingsSchema.parse({});

export function parseHeartRateSettings(value: unknown): HeartRateSettings {
  const parsed = heartRateSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_HEART_RATE_SETTINGS;
}

/** The `athlete_metrics` columns zones are resolved from. */
export type HeartRateMetricsRow = {
  heartRate: unknown;
  restHr: number | null;
  cyclingLthr: number | null;
  /** Cycling LTHR from before LTHR was split per sport. */
  lthr: number | null;
  runLthr: number | null;
  swimLthr: number | null;
};

export function athleteHeartRateFrom(
  row: HeartRateMetricsRow | null | undefined,
): AthleteHeartRate {
  return {
    settings: parseHeartRateSettings(row?.heartRate),
    restHr: row?.restHr ?? null,
    lthr: {
      cycling: row?.cyclingLthr ?? row?.lthr ?? null,
      running: row?.runLthr ?? null,
      swimming: row?.swimLthr ?? null,
    },
  };
}

/** What VO2 estimates on its own, before anything the athlete set. */
export type HeartRateEstimates = {
  restHr: number | null;
  maxHr: Record<ZonedFamily, number | null>;
};

export type HeartRateSettingsIssue = { path: string; message: string };

/** Combinations the zone and load formulas can't use; set values and estimates alike. */
export function heartRateSettingsIssues(
  settings: HeartRateSettings,
  estimates: HeartRateEstimates,
): HeartRateSettingsIssue[] {
  const issues: HeartRateSettingsIssue[] = [];
  let lowestLthr: { family: ZonedFamily; bpm: number } | null = null;
  for (const family of ZONED_FAMILIES) {
    const resolved = resolveHeartRate(family, settings, {
      restHr: estimates.restHr,
      maxHr: estimates.maxHr[family],
    });
    const label = ZONED_FAMILY_LABELS[family].toLowerCase();
    if (resolved.lthr != null && resolved.maxHr != null && resolved.lthr >= resolved.maxHr) {
      issues.push({
        path: `sports.${family}.lthr`,
        message: `Set LTHR below ${label} max heart rate (${resolved.maxHr} bpm), or raise max heart rate.`,
      });
    }
    if (resolved.lthr != null && (!lowestLthr || resolved.lthr < lowestLthr.bpm)) {
      lowestLthr = { family, bpm: resolved.lthr };
    }
    const tops = settings.sports[family].customZones;
    if (
      resolved.method === "custom" &&
      tops &&
      tops.some((top, index) => index > 0 && top <= tops[index - 1])
    ) {
      issues.push({
        path: `sports.${family}.customZones`,
        message: "Each zone must top out higher than the one before.",
      });
    }
  }
  const restHr = settings.restHr ?? estimates.restHr;
  if (restHr != null && lowestLthr && restHr >= lowestLthr.bpm) {
    issues.push({
      path: "restHr",
      message: `Set resting heart rate below ${ZONED_FAMILY_LABELS[lowestLthr.family].toLowerCase()} LTHR (${lowestLthr.bpm} bpm).`,
    });
  }
  return issues;
}
