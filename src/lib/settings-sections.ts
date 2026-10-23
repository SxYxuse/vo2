import {
  ActivityIcon,
  CalendarDaysIcon,
  HeartPulseIcon,
  RefreshCwIcon,
  TargetIcon,
  TrophyIcon,
  UserIcon,
} from "lucide-react";

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "training", label: "Training", icon: TargetIcon },
  { id: "sports", label: "Sports", icon: ActivityIcon },
  { id: "heart-rate", label: "Heart rate", icon: HeartPulseIcon },
  { id: "calendar", label: "Calendar", icon: CalendarDaysIcon },
  { id: "bests", label: "Bests", icon: TrophyIcon },
  { id: "sync", label: "Sync", icon: RefreshCwIcon },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}
