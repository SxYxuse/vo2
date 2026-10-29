import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

import { MAX_STREAM_POINTS, STREAM_CHANNELS } from "./coach-measure.ts";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const activityId = z.string().min(1).describe("The activity id, as in /activities/<id> links.");
const analysisChannel = z.enum(["heartrate", "watts", "cadence", "speed", "altitude", "grade"]);

export const findActivitiesDef = toolDefinition({
  name: "find_activities",
  description:
    "List the athlete's activities, newest first, with headline numbers. Filter by days (inclusive, in the athlete's timezone), Strava sport type such as Run or Ride, or words in the name.",
  inputSchema: z.object({
    from: day.optional(),
    to: day.optional(),
    sportType: z.string().optional(),
    nameContains: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
});

export const getActivityDef = toolDefinition({
  name: "get_activity",
  description:
    "One activity in depth: headline numbers, time in heart-rate zones, first/middle/last thirds, heart-rate drift, the anchors in effect, and its stored best efforts.",
  inputSchema: z.object({ activityId }),
});

export const measureActivityDef = toolDefinition({
  name: "measure_activity",
  description:
    "Exact numbers over part of an activity. kind=range: from `start` to `end` (metres or moving seconds from the start), e.g. the time at 1.5 km is range 0–1500 metres. kind=splits: even splits of `length`. kind=fastest: the fastest stretch of `length` metres, or the most distance in `length` seconds. Times are moving time. Use this for any time, pace, or split question; never compute them from streams yourself.",
  inputSchema: z.object({
    activityId,
    kind: z.enum(["range", "splits", "fastest"]),
    unit: z.enum(["metres", "seconds"]),
    start: z.number().min(0).optional(),
    end: z.number().min(0).optional(),
    length: z.number().positive().optional(),
  }),
});

export const getActivityStreamsDef = toolDefinition({
  name: "get_activity_streams",
  description: `Downsampled streams of one activity against distance (km) and elapsed time (s), at most ${MAX_STREAM_POINTS} points. For seeing the shape of an effort or drawing a visual; speed is km/h, grade is %.`,
  inputSchema: z.object({
    activityId,
    channels: z.array(z.enum(STREAM_CHANNELS)).min(1),
    points: z.number().int().min(10).max(MAX_STREAM_POINTS).optional(),
  }),
});

export const findClimbsDef = toolDefinition({
  name: "find_climbs",
  description:
    "The defining climbs of an activity (merged, top few by gain), with likelyHike on slow steep running.",
  inputSchema: z.object({ activityId }),
});

export const correlateStreamsDef = toolDefinition({
  name: "correlate_streams",
  description:
    "Correlation between stream pairs of an activity. Only pairs with coachRelevant=true matter; weak r is noise.",
  inputSchema: z.object({
    activityId,
    pairs: z
      .array(z.tuple([analysisChannel, analysisChannel]))
      .max(6)
      .optional(),
  }),
});

export const summarizeEffortPhasesDef = toolDefinition({
  name: "summarize_effort_phases",
  description:
    "Heart-rate surges and recoveries in an activity, and time by grade bucket. Use onClimb to tell terrain effort from early excitement.",
  inputSchema: z.object({ activityId }),
});

export const getFitnessDef = toolDefinition({
  name: "get_fitness",
  description:
    "Training load, fitness, fatigue, and form per day (form is fitness minus fatigue at the start of the day), and the current training phase. Defaults to the last 6 weeks; at most 180 days.",
  inputSchema: z.object({ from: day.optional(), to: day.optional() }),
});

export const getPersonalBestsDef = toolDefinition({
  name: "get_personal_bests",
  description:
    "The athlete's top 3 best efforts on each board (time over a distance, best power over a duration, biggest days) for a sport and period.",
  inputSchema: z.object({
    sport: z.enum(["running", "cycling", "swimming"]).optional(),
    period: z
      .string()
      .regex(/^(all|12m|6w|\d{4})$/)
      .optional()
      .describe('"all", "12m", "6w", or a year such as "2026". Defaults to "all".'),
  }),
});

export const getWeekPlanDef = toolDefinition({
  name: "get_week_plan",
  description:
    "This training week's plan, Monday to Sunday: each day's planned sessions, rest days, the week's note, and the athlete's coach notes.",
  inputSchema: z.object({}),
});

export const getSeasonDef = toolDefinition({
  name: "get_season",
  description:
    "The athlete's goals (upcoming and past, with priority and objective) and each coming week's phase and expected hours.",
  inputSchema: z.object({}),
});

export const getAthleteProfileDef = toolDefinition({
  name: "get_athlete_profile",
  description:
    "The athlete's anchors: FTP, body weight, and per sport the zone method, max, resting, and threshold heart rate, and heart-rate zone boundaries.",
  inputSchema: z.object({}),
});

export const showVisualDef = toolDefinition({
  name: "show_visual",
  description:
    "Show the athlete a visual inline in the chat: a complete, self-contained HTML document with every number typed in. It runs in a sandbox with no network, so no external scripts, fonts, or images.",
  inputSchema: z.object({
    title: z.string().min(1).max(120),
    html: z.string().min(1).max(200_000),
  }),
});
