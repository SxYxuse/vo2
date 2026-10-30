import { and, eq } from "drizzle-orm";
import {
  chat,
  chatParamsFromRequest,
  maxIterations,
  toServerSentEventsResponse,
} from "@tanstack/ai";

import { db } from "@/db/index.ts";
import { activities, activityAnalyses, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { mockActivityAnalysisText } from "./activity-analysis-mock.ts";
import { coachKeyMissing, coachModelFor } from "./coach-model.server.ts";
import { athleteHeartRateFrom } from "./heart-rate-settings.ts";
import { HEART_RATE_METRICS } from "./heart-rate.server.ts";
import { analysisMessages, persistAnalysisOnce } from "./activity-analysis-run.ts";
import { isOtherSportType } from "./sport-groups.ts";
import {
  correlateStreamsDef,
  detectElevationSegmentsDef,
  getActivityOverviewDef,
  summarizeEffortPhasesDef,
} from "./activity-analysis-tools.ts";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildActivitySamples,
  buildOverview,
  correlateStreams,
  detectElevationSegments,
  presentEffortForCoach,
  presentElevationForCoach,
  presentOverviewForCoach,
  summarizeEffort,
  type ActivityAnalysisSnapshot,
  type AnalysisStreamKey,
  type StoredActivityAnalysis,
} from "./activity-analysis.types.ts";

export type AnalysisRuntime = {
  activityId: string;
  snapshot: () => Promise<ActivityAnalysisSnapshot>;
};

export async function loadActivityAnalysisSnapshot(activityId: string, userId: string) {
  const [activityRows, metricsRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        name: activities.name,
        sportType: activities.sportType,
        movingTime: activities.movingTime,
        distance: activities.distance,
        totalElevationGain: activities.totalElevationGain,
        streamsSyncedAt: activities.streamsSyncedAt,
        time: activityStreams.time,
        distanceStream: activityStreams.distance,
        altitude: activityStreams.altitude,
        gradeSmooth: activityStreams.gradeSmooth,
        heartrate: activityStreams.heartrate,
        watts: activityStreams.watts,
        velocitySmooth: activityStreams.velocitySmooth,
        cadence: activityStreams.cadence,
      })
      .from(activities)
      .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
      .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
      .limit(1),
    db
      .select({ ...HEART_RATE_METRICS, ftp: athleteMetrics.ftp })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, userId))
      .limit(1),
  ]);
  const [row] = activityRows;
  if (!row) throw new Error("Activity not found");
  const [metrics] = metricsRows;

  const samples = row.streamsSyncedAt
    ? buildActivitySamples({
        time: row.time,
        distance: row.distanceStream,
        altitude: row.altitude,
        gradeSmooth: row.gradeSmooth,
        heartrate: row.heartrate,
        watts: row.watts,
        velocitySmooth: row.velocitySmooth,
        cadence: row.cadence,
      })
    : [];

  return {
    overview: buildOverview({
      title: row.name,
      sportType: row.sportType,
      movingTime: row.movingTime,
      distance: row.distance,
      totalElevationGain: row.totalElevationGain,
      samples,
      athlete: {
        ftp: metrics?.ftp ?? null,
        heartRate: athleteHeartRateFrom(metrics),
      },
    }),
    samples,
  } satisfies ActivityAnalysisSnapshot;
}

function createSnapshotLoader(activityId: string, userId: string) {
  let pending: Promise<ActivityAnalysisSnapshot> | null = null;
  return () => {
    pending ??= loadActivityAnalysisSnapshot(activityId, userId);
    return pending;
  };
}

export function createActivityAnalysisTools() {
  return [
    getActivityOverviewDef.server<AnalysisRuntime>(async (_input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      return presentOverviewForCoach(snapshot.overview);
    }),
    detectElevationSegmentsDef.server<AnalysisRuntime>(async (_input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      return presentElevationForCoach(
        detectElevationSegments(snapshot.samples, snapshot.overview.sportType),
        snapshot.overview.sportType,
      );
    }),
    correlateStreamsDef.server<AnalysisRuntime>(async (input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      const pairs = input.pairs as [AnalysisStreamKey, AnalysisStreamKey][] | undefined;
      return correlateStreams(snapshot.samples, pairs, snapshot.overview.sportType);
    }),
    summarizeEffortPhasesDef.server<AnalysisRuntime>(async (_input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      return presentEffortForCoach(summarizeEffort(snapshot.samples), snapshot.overview.sportType);
    }),
  ];
}

export async function getActivityAnalysisImpl(
  activityId: string,
): Promise<StoredActivityAnalysis | null> {
  const session = await getRequiredSession();
  const [row] = await db
    .select({
      activityId: activityAnalyses.activityId,
      body: activityAnalyses.body,
      mocked: activityAnalyses.mocked,
      model: activityAnalyses.model,
      updatedAt: activityAnalyses.updatedAt,
    })
    .from(activityAnalyses)
    .where(
      and(
        eq(activityAnalyses.activityId, activityId),
        eq(activityAnalyses.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    activityId: row.activityId,
    body: row.body,
    mocked: row.mocked,
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function saveActivityAnalysis(input: {
  activityId: string;
  userId: string;
  body: string;
  mocked: boolean;
  model: string;
}) {
  const body = input.body.trim();
  const { activityId, userId, mocked, model } = input;
  const now = new Date();
  await db
    .insert(activityAnalyses)
    .values({
      activityId,
      userId,
      body,
      mocked,
      model,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: activityAnalyses.activityId,
      set: { body, mocked, model, userId, updatedAt: now },
    });
  logger.info("analysis.saved", { activityId, mocked, model, chars: body.length });
}

/** Other sport types have no activity page, so they get no analysis either (ADR 0029). */
async function canAnalyseActivity(activityId: string, userId: string) {
  const [row] = await db
    .select({ sportType: activities.sportType })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
    .limit(1);
  return row != null && !isOtherSportType(row.sportType);
}

export async function handleActivityAnalysis(request: Request) {
  const session = await getOptionalSession();
  if (!session) {
    logger.warn("analysis.unauthorized");
    return new Response("Unauthorized", { status: 401 });
  }

  const activityId = new URL(request.url).searchParams.get("activityId");
  if (!activityId) {
    logger.warn("analysis.missing_activity");
    return new Response("Missing activityId", { status: 400 });
  }

  if (!(await canAnalyseActivity(activityId, session.user.id))) {
    logger.warn("analysis.activity_not_found", { activityId });
    return new Response("Activity not found", { status: 404 });
  }

  const coach = await coachModelFor(request, session.user.id, "analysis");
  if (coach.kind === "missing") return coachKeyMissing();
  // Only the run ids come from the request; the messages are built here.
  const params = await chatParamsFromRequest(request);
  const mocked = coach.kind === "mock";
  const adapter = coach.kind === "mock" ? mockActivityAnalysisText() : coach.adapter;

  logger.info("analysis.start", { activityId, model: coach.model });

  const stream = chat({
    adapter,
    messages: analysisMessages(),
    threadId: params.threadId,
    runId: params.runId,
    tools: createActivityAnalysisTools(),
    context: {
      activityId,
      snapshot: createSnapshotLoader(activityId, session.user.id),
    } satisfies AnalysisRuntime,
    systemPrompts: [ANALYSIS_SYSTEM_PROMPT],
    agentLoopStrategy: maxIterations(8),
  });

  return toServerSentEventsResponse(
    persistAnalysisOnce(stream, (body) =>
      saveActivityAnalysis({
        activityId,
        userId: session.user.id,
        body,
        mocked,
        model: coach.model,
      }),
    ),
  );
}
