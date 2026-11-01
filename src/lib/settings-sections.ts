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

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "training", label: "Training", icon: TargetIcon },
  { id: "sports", label: "Sports", icon: ActivityIcon },
  { id: "heart-rate", label: "Heart rate", icon: HeartPulseIcon },
  { id: "paces", label: "Paces", icon: GaugeIcon },
  { id: "calendar", label: "Calendar", icon: CalendarDaysIcon },
  { id: "bests", label: "Bests", icon: TrophyIcon },
  { id: "coach", label: "Coach", icon: SparklesIcon },
  { id: "sync", label: "Sync", icon: RefreshCwIcon },
] as const;

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
