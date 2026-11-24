import { CalendarDaysIcon, FlagIcon, SparklesIcon, TargetIcon } from "lucide-react";

import type { PlanningStyle } from "@/services/athlete-settings.types.ts";

const TRAINING_NAV = [
  { title: "Calendar", to: "/", icon: CalendarDaysIcon },
  { title: "Plan", to: "/week", icon: TargetIcon },
  { title: "Season", to: "/season", icon: FlagIcon },
  { title: "Coach", to: "/coach", icon: SparklesIcon },
] as const;

export type TrainingNavItem = (typeof TRAINING_NAV)[number];

export function trainingNavFor(planningStyle: PlanningStyle | null) {
  return planningStyle === "off"
    ? TRAINING_NAV.filter((item) => item.to !== "/week")
    : TRAINING_NAV;
}
