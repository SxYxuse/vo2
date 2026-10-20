import {
  ActivityIcon,
  BikeIcon,
  DumbbellIcon,
  FootprintsIcon,
  PersonStandingIcon,
  WavesIcon,
} from "lucide-react";

/** Icon and colours per sport on the Week target and session pages. */
export const SPORT_STYLE = {
  cycling: { label: "Ride", icon: BikeIcon, bar: "bg-ds-blue-700", text: "text-ds-blue-700" },
  running: {
    label: "Run",
    icon: FootprintsIcon,
    bar: "bg-ds-amber-700",
    text: "text-ds-amber-700",
  },
  swimming: { label: "Swim", icon: WavesIcon, bar: "bg-ds-teal-700", text: "text-ds-teal-700" },
  walking: {
    label: "Walk",
    icon: PersonStandingIcon,
    bar: "bg-ds-green-700",
    text: "text-ds-green-700",
  },
  strength: {
    label: "Strength",
    icon: DumbbellIcon,
    bar: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
  other: { label: "Other", icon: ActivityIcon, bar: "bg-muted-foreground", text: "" },
} as const;
