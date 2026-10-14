import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

const streamKeySchema = z.enum([
  "heartrate",
  "watts",
  "cadence",
  "speed",
  "altitude",
  "grade",
]);

export const getActivityOverviewDef = toolDefinition({
  name: "get_activity_overview",
  description:
    "Session headline plus athlete context: sport family, LTHR, FTP, time in HR zones, first/middle/last thirds, HR drift, speed fade, hike time, and whether power is a bike meter or a run estimate.",
  inputSchema: z.object({}),
});

export const detectElevationSegmentsDef = toolDefinition({
  name: "detect_elevation_segments",
  description:
    "Detect defining climbs (merged, top few by gain) rather than every short pitch. Flags likelyHike on slow steep running. Use otherClimbCount for punchy courses; do not narrate every wall.",
  inputSchema: z.object({}),
});

export const correlateStreamsDef = toolDefinition({
  name: "correlate_streams",
  description:
    "Correlation between stream pairs. Only pairs with coachRelevant=true belong in the write-up. Weak r is noise. Cardiac lag is only real when HR coupling is moderate or strong.",
  inputSchema: z.object({
    pairs: z
      .array(z.tuple([streamKeySchema, streamKeySchema]))
      .max(6)
      .optional(),
  }),
});

export const summarizeEffortPhasesDef = toolDefinition({
  name: "summarize_effort_phases",
  description:
    "Heart-rate surges and recoveries, and time by grade bucket. Use onClimb to tell terrain effort from early excitement.",
  inputSchema: z.object({}),
});
