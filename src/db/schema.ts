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
  heartRate: jsonb("heart_rate"),
  raceResult: jsonb("race_result"),
  paceSettings: jsonb("pace_settings"),
  birthDate: date("birth_date", { mode: "string" }),
  weightKg: real("weight_kg"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    priority: text("priority").$type<"A" | "B">().notNull().default("A"),
    effort: text("effort").$type<"fun" | "steady" | "allOut">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("goals_user_date_idx").on(table.userId, table.date)],
);

export const topEffortCelebrations = pgTable(
  "top_effort_celebrations",
  {
    activityId: text("activity_id")
      .primaryKey()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    placements: jsonb("placements").notNull(),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => [index("top_effort_celebrations_user_idx").on(table.userId, table.seenAt)],
);

export const coachKeys = pgTable(
  "coach_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("openrouter"),
    sealed: text("sealed").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);

export const coachUsage = pgTable(
  "coach_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
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

export const coachPlans = pgTable("coach_plans", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  availability: jsonb("availability").notNull(),
  timeZone: text("time_zone").notNull(),
  plan: jsonb("plan"),
  status: text("status").notNull().default("idle"),
  error: text("error"),
  statusAt: timestamp("status_at", { withTimezone: true }).notNull().defaultNow(),
  requestedFrom: date("requested_from", { mode: "string" }),
  attemptKey: text("attempt_key"),
  progression: jsonb("progression"),
  brief: text("brief").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const coachPlanProposals = pgTable(
  "coach_plan_proposals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planKey: text("plan_key").notNull(),
    change: jsonb("change").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coach_plan_proposals_user_idx").on(table.userId)],
);

export const coachChats = pgTable(
  "coach_chats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    messages: jsonb("messages").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coach_chats_user_updated_idx").on(table.userId, table.updatedAt)],
);

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

export const powerFiles = pgTable(
  "power_files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    file: bytea("file").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    summary: jsonb("summary").notNull(),
    analysis: jsonb("analysis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("power_files_user_hash_idx").on(table.userId, table.fileHash),
    index("power_files_user_start_idx").on(table.userId, table.startDate),
  ],
);

export const timeOuts = pgTable(
  "time_outs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"sick" | "injured">().notNull(),
    startDay: date("start_day", { mode: "string" }).notNull(),
    endDay: date("end_day", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("time_outs_user_start_idx").on(table.userId, table.startDay)],
);
