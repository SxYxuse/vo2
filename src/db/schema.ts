import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema.ts";

export * from "./auth-schema.ts";

export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id").notNull(),
    name: text("name").notNull(),
    sportType: text("sport_type").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    elapsedTime: integer("elapsed_time").notNull(),
    movingTime: integer("moving_time").notNull(),
    distance: real("distance"),
    totalElevationGain: real("total_elevation_gain"),
    timezone: text("timezone"),
    summaryPolyline: text("summary_polyline"),
    raw: jsonb("raw").notNull(),
    streamsSyncedAt: timestamp("streams_synced_at", { withTimezone: true }),
    hasHeartrate: boolean("has_heartrate").notNull().default(false),
    averageHeartrate: real("average_heartrate"),
    maxHeartrate: real("max_heartrate"),
    averageWatts: real("average_watts"),
    weightedAverageWatts: real("weighted_average_watts"),
    deviceWatts: boolean("device_watts").notNull().default(false),
    trainingLoad: real("training_load"),
    /** Average HR borrowed from similar activities when this one recorded none (ADR 0019). */
    estimatedHeartrate: real("estimated_heartrate"),
    loadSource: text("load_source").$type<
      "power" | "heartRate" | "similarHeartRate" | "duration"
    >(),
    manual: boolean("manual").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activities_user_start_idx").on(table.userId, table.startDate)],
);

export const activityAnalyses = pgTable(
  "activity_analyses",
  {
    activityId: text("activity_id")
      .primaryKey()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    mocked: boolean("mocked").notNull().default(false),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_analyses_user_idx").on(table.userId)],
);

export const activityStreams = pgTable("activity_streams", {
  activityId: text("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  time: jsonb("time").$type<number[]>(),
  latlng: jsonb("latlng").$type<number[][]>(),
  distance: jsonb("distance").$type<number[]>(),
  altitude: jsonb("altitude").$type<number[]>(),
  velocitySmooth: jsonb("velocity_smooth").$type<number[]>(),
  heartrate: jsonb("heartrate").$type<number[]>(),
  cadence: jsonb("cadence").$type<number[]>(),
  watts: jsonb("watts").$type<number[]>(),
  temp: jsonb("temp").$type<number[]>(),
  moving: jsonb("moving").$type<boolean[]>(),
  gradeSmooth: jsonb("grade_smooth").$type<number[]>(),
  chartPreview: jsonb("chart_preview"),
  rideAnalysis: jsonb("ride_analysis"),
  heartAnalysis: jsonb("heart_analysis"),
  bestEfforts: jsonb("best_efforts"),
  raw: jsonb("raw").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const athleteMetrics = pgTable("athlete_metrics", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  ftp: real("ftp"),
  lthr: real("lthr"),
  cyclingLthr: real("cycling_lthr"),
  runLthr: real("run_lthr"),
  swimLthr: real("swim_lthr"),
  restHr: real("rest_hr"),
  /** Anchors the athlete set and each sport's zone method; the columns above stay estimates. */
  heartRate: jsonb("heart_rate"),
  /** A recent race result the athlete set; it wins over the training-pace estimate. */
  raceResult: jsonb("race_result"),
  birthDate: date("birth_date", { mode: "string" }),
  weightKg: real("weight_kg"),
  training: jsonb("training"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The table keeps its older name; renaming it would need a migration. */
export const athleteSettings = pgTable("calendar_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncRuns = pgTable("sync_runs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("idle"),
  activitiesUpserted: integer("activities_upserted").notNull().default(0),
  streamsFetched: integer("streams_fetched").notNull().default(0),
  streamsPending: integer("streams_pending").notNull().default(0),
  shortLimitRemaining: integer("short_limit_remaining"),
  dailyLimitRemaining: integer("daily_limit_remaining"),
  pausedUntil: timestamp("paused_until", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A race or event on the athlete's season; goals drive the week target (ADR 0023). */
export const goals = pgTable(
  "goals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sportType: text("sport_type").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    distanceM: real("distance_m"),
    elevationGainM: real("elevation_gain_m"),
    objective: text("objective").$type<"finish" | "finishWell" | "perform">().notNull(),
    /** A: peak and taper for it; B: a few lighter days; C: trained through (ADR 0024). */
    priority: text("priority").$type<"A" | "B" | "C">().notNull().default("A"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("goals_user_date_idx").on(table.userId, table.date)],
);

/**
 * The athlete's notes about this training week and the day plan made from them (ADR 0024).
 * One row per week; re-planned when a sync or a note changes its inputs.
 */
export const weekCoach = pgTable(
  "week_coach",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    notes: jsonb("notes").notNull().default([]),
    plan: jsonb("plan"),
    /** What the plan was made from; a different key means it is stale. */
    inputKey: text("input_key"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.weekStart] })],
);

/**
 * Each activity checked for top 10 efforts after its stream arrived, with the placements it held
 * then (ADR 0027). An activity with none is stored seen, so it is never checked again.
 */
export const topEffortCelebrations = pgTable(
  "top_effort_celebrations",
  {
    activityId: text("activity_id")
      .primaryKey()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** TopEffortPlacement[], best first. */
    placements: jsonb("placements").notNull(),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => [index("top_effort_celebrations_user_idx").on(table.userId, table.seenAt)],
);

/**
 * The athlete's own OpenRouter key, encrypted with a key derived from BETTER_AUTH_SECRET so it
 * follows them to every device; only the server ever decrypts it (ADR 0036).
 */
export const coachKeys = pgTable("coach_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** AES-256-GCM: base64 iv, auth tag, and ciphertext, joined by dots. */
  sealed: text("sealed").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The coach plan (ADR 0037): the athlete's availability, the plan as last written, and whether
 * one is being written now. Writing runs on the server, so the app picks it up when it returns.
 */
export const coachPlans = pgTable("coach_plans", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  availability: jsonb("availability").notNull(),
  /** Days are the athlete's: today and the plan's weeks are read in this time zone. */
  timeZone: text("time_zone").notNull(),
  /** The last plan that passed every rule; it stays until a new one passes. */
  plan: jsonb("plan"),
  status: text("status").notNull().default("idle"),
  /** Why the last writing failed, for the athlete. */
  error: text("error"),
  statusAt: timestamp("status_at", { withTimezone: true }).notNull().defaultNow(),
  /** The athlete asked for the weeks from this day to be written again. */
  requestedFrom: date("requested_from", { mode: "string" }),
  /** What the last writing started from, so a failed one isn't started again on every load. */
  attemptKey: text("attempt_key"),
  /** Runs the athlete linked to or unlinked from sessions; their choice wins (ADR 0037). */
  links: jsonb("links"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
