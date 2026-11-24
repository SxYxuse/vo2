import { CalendarDaysIcon, FlagIcon, SparklesIcon, TargetIcon } from "lucide-react";

import type { PlanningStyle } from "@/services/athlete-settings.types.ts";

const TRAINING_NAV = [
  {
    title: "Calendar",
    to: "/",
    icon: CalendarDaysIcon,
    matches: (pathname: string) => pathname === "/" || pathname.startsWith("/activities/"),
  },
  {
    title: "Plan",
    to: "/week",
    icon: TargetIcon,
    matches: (pathname: string) => pathname === "/week" || pathname.startsWith("/week/"),
  },
  {
    title: "Season",
    to: "/season",
    icon: FlagIcon,
    matches: (pathname: string) => pathname === "/season",
  },
  {
    title: "Coach",
    to: "/coach",
    icon: SparklesIcon,
    matches: (pathname: string) => pathname === "/coach",
  },
] as const;

export type TrainingNavItem = (typeof TRAINING_NAV)[number];

export function isTrainingPath(pathname: string) {
  return TRAINING_NAV.some((item) => item.matches(pathname));
}

export function trainingNavFor(planningStyle: PlanningStyle | null) {
  return planningStyle === "off"
    ? TRAINING_NAV.filter((item) => item.to !== "/week")
    : TRAINING_NAV;
}
