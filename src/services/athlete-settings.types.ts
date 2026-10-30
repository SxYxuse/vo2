import { differenceInYears, isValid } from "date-fns";
import { z } from "zod";

import { coachModelsSchema, DEFAULT_COACH_MODELS } from "./coach-models.ts";
import {
  DEFAULT_SPORT_GROUP_SHARES,
  isOtherSportType,
  mergeSportGroupShares,
  sportGroupFor,
  SPORT_GROUPS,
  type SportGroupId,
} from "./sport-groups.ts";

const GEIST_HUES = ["blue", "red", "amber", "green", "teal", "purple", "pink", "gray"] as const;

export const ACTIVITY_COLOR_OPTIONS = GEIST_HUES.map((hue) => ({
  value: `var(--color-ds-${hue}-700)`,
  label: `${hue[0].toUpperCase()}${hue.slice(1)}`,
}));

const DEFAULT_SPORT_COLORS: Record<string, string> = {
  Run: "var(--color-ds-amber-700)",
  TrailRun: "var(--color-ds-red-700)",
  Ride: "var(--color-ds-blue-700)",
  VirtualRide: "var(--color-ds-teal-700)",
  MountainBikeRide: "var(--color-ds-green-700)",
  GravelRide: "var(--color-ds-green-700)",
  EBikeRide: "var(--color-ds-teal-700)",
  EMountainBikeRide: "var(--color-ds-teal-700)",
  Swim: "var(--color-ds-teal-700)",
  Walk: "var(--color-ds-gray-700)",
  Hike: "var(--color-ds-green-700)",
  Workout: "var(--color-ds-purple-700)",
  WeightTraining: "var(--color-ds-red-700)",
  Yoga: "var(--color-ds-pink-700)",
  Velomobile: "var(--color-ds-blue-700)",
  Handcycle: "var(--color-ds-purple-700)",
};

const GEIST_700_VALUES = new Set(ACTIVITY_COLOR_OPTIONS.map((option) => option.value));

function coerceToGeist700(color: string) {
  const match = color.match(
    /--color-ds-(blue|red|amber|green|teal|purple|pink|gray)(?:-alpha)?-\d+/,
  );
  if (match) return `var(--color-ds-${match[1]}-700)`;
  return GEIST_700_VALUES.has(color) ? color : "var(--color-ds-gray-700)";
}

const sportTypeSettingSchema = z.object({
  visible: z.boolean(),
  color: z.string(),
  heartRate: z.boolean().default(true),
  power: z.boolean().default(false),
});

export const CALENDAR_PERIODS = [
  {
    id: "month",
    label: "Current month",
    hint: "One calendar month. Days of the neighbouring months stay blank.",
  },
  {
    id: "weeks",
    label: "Last 4 weeks",
    hint: "The current training week and the three before it.",
  },
] as const;

export const calendarPeriodSchema = z.enum(["month", "weeks"]);
export type CalendarPeriod = z.infer<typeof calendarPeriodSchema>;

const athleteSettingsSchema = z.object({
  sportTypes: z.record(z.string(), sportTypeSettingSchema),
  sportGroupShares: z.record(z.string(), z.boolean()).optional(),
  calendarPeriod: calendarPeriodSchema.default("month"),
  /** When the athlete turned on top 10 effort celebrations; null while off (ADR 0027). */
  topEffortsSince: z.iso.datetime().nullable().default(null),
  /** The model each coach feature runs on; the key itself is sealed in coach_keys (ADR 0036). */
  coachModels: coachModelsSchema.default(DEFAULT_COACH_MODELS),
});

export const SHOW_ONE_SPORT_MESSAGE = "Show at least one sport.";

/** True when sport types have been copied and the athlete hid all of them. */
export function hidesEverySportType(sportTypes: Record<string, { visible: boolean }>) {
  const settings = Object.values(sportTypes);
  return settings.length > 0 && settings.every((setting) => !setting.visible);
}

/** Sport type settings for a save: once any type is copied, at least one must stay shown. */
export const shownSportTypesSchema = athleteSettingsSchema.shape.sportTypes.refine(
  (sportTypes) => !hidesEverySportType(sportTypes),
  { error: SHOW_ONE_SPORT_MESSAGE },
);

type SportTypeSetting = z.infer<typeof sportTypeSettingSchema>;
export type AthleteSettings = z.infer<typeof athleteSettingsSchema>;
export type SportTypeSettings = AthleteSettings["sportTypes"];

/**
 * Hidden sport types stay out of the calendar, map, and heart-rate views only (ADR 0018); other
 * sport types are never shown (ADR 0029).
 */
export function isSportTypeShown(sportTypes: SportTypeSettings, sportType: string) {
  return !isOtherSportType(sportType) && sportTypes[sportType]?.visible !== false;
}

/** Falls back to the sport type's default for a type the settings don't know yet. */
export function sportTypeColor(sportTypes: SportTypeSettings, sportType: string) {
  return sportTypes[sportType]?.color ?? defaultColorForSport(sportType);
}

export type SportCollectors = {
  heartRate: boolean;
  power: boolean;
  powerPartial: boolean;
};

const EMPTY_COLLECTORS: SportCollectors = {
  heartRate: true,
  power: false,
  powerPartial: false,
};

export function sportOffersPower(sportType: string) {
  return sportGroupFor(sportType)?.id === "cycling";
}

export function heartRateCollectorLabel(sportType: string) {
  const group = sportGroupFor(sportType)?.id;
  if (group === "cycling") return "HR belt";
  if (group === "running" || group === "walking") return "HR watch";
  return "Heart rate";
}

/** Sensors are still worn when a sport type is hidden, so hidden types count (ADR 0018). */
export function familyCollectors(
  sportTypes: SportTypeSettings,
  family: SportGroupId,
): SportCollectors {
  const members = SPORT_GROUPS.find((group) => group.id === family)?.members ?? [];
  const pool = members
    .map((sportType) => sportTypes[sportType])
    .filter((setting): setting is SportTypeSetting => Boolean(setting));
  if (!pool.length) return EMPTY_COLLECTORS;
  const withPower = pool.filter((setting) => setting.power).length;
  return {
    heartRate: pool.some((setting) => setting.heartRate),
    power: withPower > 0,
    powerPartial: withPower > 0 && withPower < pool.length,
  };
}

/**
 * Turning top 10 effort celebrations on starts the clock, so nothing found before counts; a save
 * that leaves the switch alone keeps it (ADR 0027).
 */
export function nextTopEffortsSince(
  stored: string | null,
  celebrate: boolean | undefined,
  now: Date,
) {
  if (celebrate === undefined) return stored;
  if (!celebrate) return null;
  return stored ?? now.toISOString();
}

export const DEFAULT_ATHLETE_SETTINGS: AthleteSettings = {
  sportTypes: {},
  sportGroupShares: DEFAULT_SPORT_GROUP_SHARES,
  calendarPeriod: "month",
  topEffortsSince: null,
  coachModels: DEFAULT_COACH_MODELS,
};

export function formatSportType(sportType: string) {
  return sportType.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function sortSportTypeKeys(sportTypes: SportTypeSettings) {
  return Object.keys(sportTypes).sort((a, b) => {
    const aVisible = isSportTypeShown(sportTypes, a);
    const bVisible = isSportTypeShown(sportTypes, b);
    if (aVisible !== bVisible) return aVisible ? -1 : 1;
    return formatSportType(a).localeCompare(formatSportType(b));
  });
}

function defaultColorForSport(sportType: string) {
  return coerceToGeist700(DEFAULT_SPORT_COLORS[sportType] ?? "var(--color-ds-gray-700)");
}

/** Only sport-group types are listed: other sport types are never shown (ADR 0029). */
function detectedSportTypes(sportTypes: string[]) {
  return Array.from(new Set(sportTypes.filter((sportType) => !isOtherSportType(sportType)))).sort(
    (a, b) => formatSportType(a).localeCompare(formatSportType(b)),
  );
}

/** Older rows lack sensors, and colours predate the Geist 700 palette. */
function normalizeSportTypeSetting(sportType: string, setting: Record<string, unknown>) {
  return {
    ...setting,
    color: typeof setting.color === "string" ? coerceToGeist700(setting.color) : setting.color,
    heartRate: setting.heartRate !== false,
    power: sportOffersPower(sportType) && setting.power === true,
  };
}

/** Validates a stored or submitted value and normalises every sport type in it. */
export function parseAthleteSettings(value: unknown): AthleteSettings | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sportTypes =
    raw.sportTypes && typeof raw.sportTypes === "object"
      ? Object.fromEntries(
          Object.entries(raw.sportTypes as Record<string, Record<string, unknown>>).map(
            ([sportType, setting]) => [sportType, normalizeSportTypeSetting(sportType, setting)],
          ),
        )
      : raw.sportTypes;
  const parsed = athleteSettingsSchema.safeParse({ ...raw, sportTypes });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    sportGroupShares: mergeSportGroupShares(parsed.data.sportGroupShares),
  };
}

/** Keeps the sport-group types in the local copy, adding defaults for new ones. */
export function mergeAthleteSettings(
  stored: AthleteSettings | null,
  sportTypeNames: string[],
): AthleteSettings {
  const base = stored ?? DEFAULT_ATHLETE_SETTINGS;
  const sportTypes: SportTypeSettings = {};
  for (const sportType of detectedSportTypes(sportTypeNames)) {
    sportTypes[sportType] = base.sportTypes[sportType] ?? {
      visible: true,
      color: defaultColorForSport(sportType),
      heartRate: true,
      power: false,
    };
  }
  return {
    ...base,
    sportTypes,
    sportGroupShares: mergeSportGroupShares(base.sportGroupShares),
  };
}

const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MIN_WEIGHT_KG = 30;
export const MAX_WEIGHT_KG = 200;
const weightKgSchema = z.number().min(MIN_WEIGHT_KG).max(MAX_WEIGHT_KG);

/** Stored profile: athletes who onboarded before a field was required may lack it. */
export const profileSettingsSchema = z.object({
  birthDate: birthDateSchema.nullable(),
  weightKg: weightKgSchema.nullable(),
});

/** Every save carries a birthday and a weight, so neither can be cleared once set. */
export const profileSaveSchema = z.object({
  birthDate: birthDateSchema,
  weightKg: weightKgSchema,
});

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;
export type ProfileSave = z.infer<typeof profileSaveSchema>;

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  birthDate: null,
  weightKg: null,
};

/** Age and weight are both required before the app opens. */
export function isProfileComplete(profile: ProfileSettings) {
  return profile.birthDate != null && profile.weightKg != null;
}

export function parseBirthDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return isValid(date) ? date : null;
}

export function formatBirthDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ageFromBirthDate(value: string | null, now = new Date()) {
  if (!value) return null;
  const birth = parseBirthDate(value);
  if (!birth || birth > now) return null;
  return differenceInYears(now, birth);
}
