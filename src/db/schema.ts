import {
  boolean,
  customType,
  doublePrecision,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
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
  /** Flat running time by heart rate and pace, for the easy pace from zone 2 (ADR 0042). */
  flatPaces: jsonb("flat_paces"),
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
  /** What the training paces and the easy pace are read from (ADR 0042). */
  paceSettings: jsonb("pace_settings"),
  birthDate: date("birth_date", { mode: "string" }),
  weightKg: real("weight_kg"),
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

/** A race or event on the athlete's season; goals shape the coach plan (ADR 0050). */
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
    /** A: a main goal, built, peaked, and tapered for; B: a supporting race (ADR 0052). */
    priority: text("priority").$type<"A" | "B">().notNull().default("A"),
    /** How hard a supporting race is run: fun, steady, or allOut. Null for a main goal. */
    effort: text("effort").$type<"fun" | "steady" | "allOut">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("goals_user_date_idx").on(table.userId, table.date)],
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
 * The athlete's own provider keys, one per provider (ADR 0059), each encrypted with a key derived
 * from BETTER_AUTH_SECRET so it follows them to every device; only the server ever decrypts it
 * (ADR 0036).
 */
export const coachKeys = pgTable(
  "coach_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** A COACH_PROVIDERS id. Keys saved before ADR 0059 are all OpenRouter's. */
    provider: text("provider").notNull().default("openrouter"),
    /** AES-256-GCM: base64 iv, auth tag, and ciphertext, joined by dots. */
    sealed: text("sealed").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);

/**
 * What each coach model call used, so the athlete can follow what the coach costs them on their
 * own keys. One row per model call; a chat answer that calls tools makes several.
 */
export const coachUsage = pgTable(
  "coach_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** A COACH_FEATURES id. */
    feature: text("feature").notNull(),
    /** A COACH_PROVIDERS id. */
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    /** US dollars, as the provider billed it. Null when the provider reports no cost (OpenAI). */
    costUsd: doublePrecision("cost_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coach_usage_user_created_idx").on(table.userId, table.createdAt)],
);

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
  /** How fast each sport's budget grows, and the athlete's own peaks (ADR 0058). */
  progression: jsonb("progression"),
  /** The coach brief: standing context the athlete writes for the coach. Empty means none. */
  brief: text("brief").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Plan changes the coach proposed in the chat that passed every rule (ADR 0038). Applying takes one
 * by id, so only a checked change is ever saved, and only onto the plan it was checked against.
 */
export const coachPlanProposals = pgTable(
  "coach_plan_proposals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The plan it was checked against, hashed: applying needs the same plan. */
    planKey: text("plan_key").notNull(),
    /** The changed days and the sessions on them after the change. */
    change: jsonb("change").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coach_plan_proposals_user_idx").on(table.userId)],
);

/**
 * Coach chats, kept on the server so every device sees them and the athlete can reopen any of
 * them later. TanStack AI's `withPersistence` writes the transcript; VO2 adds the owner and title.
 */
export const coachChats = pgTable(
  "coach_chats",
  {
    /** The chat's TanStack AI thread id, made by the app when the athlete starts a chat. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The athlete's first question, shortened, so the list of chats reads at a glance. */
    title: text("title").notNull(),
    /** The model messages in order (TanStack AI `ModelMessage[]`). */
    messages: jsonb("messages").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coach_chats_user_updated_idx").on(table.userId, table.updatedAt)],
);

/**
 * Each answer the coach gave or is giving in a chat (TanStack AI `RunRecord`), so a reload can
 * find a reply still running. The record is stored whole; the columns are what's queried.
 */
export const coachChatRuns = pgTable(
  "coach_chat_runs",
  {
    runId: text("run_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    record: jsonb("record").notNull(),
  },
  (table) => [index("coach_chat_runs_thread_idx").on(table.threadId, table.startedAt)],
);

/**
 * A plan change waiting on the athlete's Apply or Decline (TanStack AI `InterruptRecord`), so it
 * is offered again on any device until answered (ADR 0038).
 */
export const coachChatInterrupts = pgTable(
  "coach_chat_interrupts",
  {
    interruptId: text("interrupt_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    runId: text("run_id").notNull(),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    record: jsonb("record").notNull(),
  },
  (table) => [
    index("coach_chat_interrupts_thread_idx").on(table.threadId, table.requestedAt),
    index("coach_chat_interrupts_run_idx").on(table.runId, table.requestedAt),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Ride FIT files the athlete imported for power analysis (ADR 0056). The file is kept so a newer
 * analysis can read it again; Postgres compresses it. Never part of load, fitness, or bests.
 */
export const powerFiles = pgTable(
  "power_files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    /** SHA-256 of the FIT bytes: importing the same ride again opens the first import. */
    fileHash: text("file_hash").notNull(),
    file: bytea("file").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    /** What the list shows, so it never reads the analyses. */
    summary: jsonb("summary").notNull(),
    analysis: jsonb("analysis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("power_files_user_hash_idx").on(table.userId, table.fileHash),
    index("power_files_user_start_idx").on(table.userId, table.startDate),
  ],
);
