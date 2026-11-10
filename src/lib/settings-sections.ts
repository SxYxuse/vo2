import {
  ActivityIcon,
  CalendarDaysIcon,
  GaugeIcon,
  HeartPulseIcon,
  RefreshCwIcon,
  SparklesIcon,
  TargetIcon,
  TrophyIcon,
  UserIcon,
} from "lucide-react";

import { SPORT_GROUPS } from "@/services/sport-groups.ts";

export const SETTINGS_GROUPS = [
  { id: "you", label: "You" },
  { id: "training", label: "Training" },
  { id: "app", label: "App" },
] as const;

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon, group: "you" },
  { id: "heart-rate", label: "Heart rate", icon: HeartPulseIcon, group: "you" },
  { id: "paces", label: "Paces", icon: GaugeIcon, group: "you" },
  { id: "training", label: "Planning", icon: TargetIcon, group: "training" },
  { id: "sports", label: "Sports", icon: ActivityIcon, group: "training" },
  { id: "calendar", label: "Calendar", icon: CalendarDaysIcon, group: "training" },
  { id: "bests", label: "Bests", icon: TrophyIcon, group: "training" },
  { id: "coach", label: "Coach", icon: SparklesIcon, group: "app" },
  { id: "sync", label: "Sync", icon: RefreshCwIcon, group: "app" },
] as const satisfies ReadonlyArray<{
  id: string;
  group: (typeof SETTINGS_GROUPS)[number]["id"];
  [key: string]: unknown;
}>;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/**
 * Paces are running paces: only an athlete who shows a running sport type sees the section, so
 * one who never ran, or hid every running type, doesn't. Until settings load, every section shows.
 */
export function showsSettingsSection(
  section: SettingsSection,
  sportTypes: Record<string, { visible: boolean }> | undefined,
) {
  if (section !== "paces" || !sportTypes) return true;
  return RUNNING_TYPES.some((type) => sportTypes[type]?.visible === true);
}

const RUNNING_TYPES = SPORT_GROUPS.find((group) => group.id === "running")!.members;
