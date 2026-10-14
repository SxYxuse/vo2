import { z } from "zod";

import {
  DEFAULT_SPORT_GROUP_SHARES,
  mergeSportGroupShares,
  sportGroupFor,
  SPORT_GROUPS,
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
  const match = color.match(/--color-ds-(blue|red|amber|green|teal|purple|pink|gray)(?:-alpha)?-\d+/);
  if (match) return `var(--color-ds-${match[1]}-700)`;
  return GEIST_700_VALUES.has(color) ? color : "var(--color-ds-gray-700)";
}

const sportTypeSettingSchema = z.object({
  visible: z.boolean(),
  color: z.string(),
  heartRate: z.boolean().default(true),
  power: z.boolean().default(false),
});

export const calendarSettingsSchema = z.object({
  viewSettings: z.object({
    weekends: z.boolean(),
    weekNumbers: z.boolean(),
    nowIndicator: z.boolean(),
    offDays: z.boolean(),
  }),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  dayStartHour: z.number().int().min(0).max(24),
  dayEndHour: z.number().int().min(0).max(24),
  interval: z.number().int().positive(),
  snapDuration: z.number().int().positive(),
  sportTypes: z.record(z.string(), sportTypeSettingSchema),
  sportGroupShares: z.record(z.string(), z.boolean()).optional(),
});

type SportTypeSetting = z.infer<typeof sportTypeSettingSchema>;
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

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

function sportPowerEnabled(sportType: string, power: boolean | undefined) {
  return sportOffersPower(sportType) && power === true;
}

function withSportCollectors(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const sportTypes = raw.sportTypes;
  if (!sportTypes || typeof sportTypes !== "object") return raw;
  return {
    ...raw,
    sportTypes: Object.fromEntries(
      Object.entries(sportTypes as Record<string, Record<string, unknown>>).map(
        ([sportType, setting]) => [
          sportType,
          {
            ...setting,
            heartRate: setting.heartRate !== false,
            power: sportPowerEnabled(sportType, setting.power === true),
          },
        ],
      ),
    ),
  };
}

export function familyCollectors(
  sportTypes: CalendarSettings["sportTypes"],
  family: "running" | "cycling",
): SportCollectors {
  const members = SPORT_GROUPS.find((group) => group.id === family)?.members ?? [];
  const pool = members
    .map((sportType) => sportTypes[sportType])
    .filter((setting): setting is SportTypeSetting => Boolean(setting))
    .filter((setting) => setting.visible !== false);
  if (!pool.length) return EMPTY_COLLECTORS;
  const withPower = pool.filter((setting) => setting.power).length;
  return {
    heartRate: pool.some((setting) => setting.heartRate),
    power: withPower > 0,
    powerPartial: withPower > 0 && withPower < pool.length,
  };
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  viewSettings: {
    weekends: true,
    weekNumbers: false,
    nowIndicator: true,
    offDays: false,
  },
  weekStartsOn: 1,
  dayStartHour: 0,
  dayEndHour: 24,
  interval: 60,
  snapDuration: 15,
  sportTypes: {},
  sportGroupShares: DEFAULT_SPORT_GROUP_SHARES,
};

export function formatSportType(sportType: string) {
  return sportType
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function sortSportTypeKeys(sportTypes: CalendarSettings["sportTypes"]) {
  return Object.keys(sportTypes).sort((a, b) => {
    const aVisible = sportTypes[a]?.visible !== false;
    const bVisible = sportTypes[b]?.visible !== false;
    if (aVisible !== bVisible) return aVisible ? -1 : 1;
    return formatSportType(a).localeCompare(formatSportType(b));
  });
}

function defaultColorForSport(sportType: string) {
  return coerceToGeist700(DEFAULT_SPORT_COLORS[sportType] ?? "var(--color-ds-gray-700)");
}

function detectedSportTypes(sportTypes: string[]) {
  return Array.from(new Set(sportTypes)).sort((a, b) =>
    formatSportType(a).localeCompare(formatSportType(b)),
  );
}

export function parseCalendarSettings(value: unknown): CalendarSettings | null {
  const parsed = calendarSettingsSchema.safeParse(withSportCollectors(value));
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    sportGroupShares: mergeSportGroupShares(parsed.data.sportGroupShares),
    sportTypes: Object.fromEntries(
      Object.entries(parsed.data.sportTypes).map(([sportType, setting]) => [
        sportType,
        {
          visible: setting.visible,
          color: coerceToGeist700(setting.color),
          heartRate: setting.heartRate !== false,
          power: sportPowerEnabled(sportType, setting.power),
        },
      ]),
    ),
  };
}

export function mergeCalendarSettings(
  stored: CalendarSettings | null | undefined,
  sportTypeNames: string[],
): CalendarSettings {
  const base = stored
    ? {
        ...DEFAULT_CALENDAR_SETTINGS,
        ...stored,
        viewSettings: {
          ...DEFAULT_CALENDAR_SETTINGS.viewSettings,
          ...stored.viewSettings,
        },
        sportTypes: stored.sportTypes ?? {},
        sportGroupShares: mergeSportGroupShares(stored.sportGroupShares),
      }
    : DEFAULT_CALENDAR_SETTINGS;

  const sportTypes: Record<string, SportTypeSetting> = {};
  for (const sportType of detectedSportTypes(sportTypeNames)) {
    const storedType = base.sportTypes[sportType];
    sportTypes[sportType] = storedType
      ? {
          visible: storedType.visible,
          color: coerceToGeist700(storedType.color),
          heartRate: storedType.heartRate !== false,
          power: sportPowerEnabled(sportType, storedType.power),
        }
      : {
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
