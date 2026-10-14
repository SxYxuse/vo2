export const SPORT_GROUP_IDS = ["cycling", "running", "swimming", "walking"] as const;

export type SportGroupId = (typeof SPORT_GROUP_IDS)[number];

export type SportGroup = {
  id: SportGroupId;
  label: string;
  canonical: string;
  members: readonly string[];
};

export const SPORT_GROUPS: SportGroup[] = [
  {
    id: "cycling",
    label: "Ride sports",
    canonical: "Ride",
    members: [
      "Ride",
      "VirtualRide",
      "GravelRide",
      "MountainBikeRide",
      "EMountainBikeRide",
      "EBikeRide",
      "Velomobile",
      "Handcycle",
    ],
  },
  {
    id: "running",
    label: "Run sports",
    canonical: "Run",
    members: ["Run", "TrailRun", "VirtualRun"],
  },
  {
    id: "swimming",
    label: "Swim sports",
    canonical: "Swim",
    members: ["Swim", "OpenWaterSwim"],
  },
  {
    id: "walking",
    label: "Walk sports",
    canonical: "Walk",
    members: ["Walk", "Hike"],
  },
];

export const DEFAULT_SPORT_GROUP_SHARES: Record<SportGroupId, boolean> = {
  cycling: true,
  running: true,
  swimming: true,
  walking: true,
};

const MEMBER_TO_GROUP = new Map<string, SportGroup>();
for (const group of SPORT_GROUPS) {
  for (const member of group.members) {
    MEMBER_TO_GROUP.set(member, group);
  }
}

export function sportGroupFor(sportType: string) {
  return MEMBER_TO_GROUP.get(sportType) ?? null;
}

export function mergeSportGroupShares(
  stored: Record<string, boolean> | null | undefined,
): Record<SportGroupId, boolean> {
  const shares = { ...DEFAULT_SPORT_GROUP_SHARES };
  if (!stored) return shares;
  for (const id of SPORT_GROUP_IDS) {
    if (typeof stored[id] === "boolean") shares[id] = stored[id];
  }
  return shares;
}

export function sharesGroupData(
  shares: Record<string, boolean> | null | undefined,
  groupId: SportGroupId,
) {
  return mergeSportGroupShares(shares)[groupId];
}
