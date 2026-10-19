import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
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
    loadSource: text("load_source").$type<"power" | "heartRate" | "duration">(),
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
  birthDate: date("birth_date", { mode: "string" }),
  weightKg: real("weight_kg"),
  heightCm: real("height_cm"),
  training: jsonb("training"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    sportFamily: text("sport_family").$type<"running" | "cycling">().notNull(),
    title: text("title").notNull(),
    targetMinutes: integer("target_minutes").notNull(),
    targetLoad: real("target_load").notNull(),
    status: text("status").$type<"planned" | "done" | "adapted">().notNull().default("planned"),
    note: text("note"),
    activityId: text("activity_id").references(() => activities.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("planned_sessions_user_week_idx").on(table.userId, table.weekStart),
    uniqueIndex("planned_sessions_activity_idx")
      .on(table.activityId)
      .where(sql`${table.activityId} is not null`),
  ],
);

export const calendarSettings = pgTable("calendar_settings", {
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
