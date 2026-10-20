import { and, eq } from "drizzle-orm";
import {
  chat,
  chatParamsFromRequest,
  maxIterations,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import { activities, activityAnalyses, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { APP_NAME } from "@/lib/brand.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { mockActivityAnalysisText } from "./activity-analysis-mock.ts";
import { analysisMessages, persistAnalysisOnce } from "./activity-analysis-run.ts";
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

const ANALYSIS_MODEL = "openai/gpt-6-luna";

export type AnalysisRuntime = {
  activityId: string;
  snapshot: () => Promise<ActivityAnalysisSnapshot>;
};

async function loadActivityAnalysisSnapshot(activityId: string, userId: string) {
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
      .select({
        ftp: athleteMetrics.ftp,
        cyclingLthr: athleteMetrics.cyclingLthr,
        runLthr: athleteMetrics.runLthr,
        swimLthr: athleteMetrics.swimLthr,
        lthr: athleteMetrics.lthr,
      })
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
        cyclingLthr: metrics?.cyclingLthr ?? metrics?.lthr ?? null,
        runLthr: metrics?.runLthr ?? null,
        swimLthr: metrics?.swimLthr ?? null,
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

export function isAnalysisMocked() {
  return !env.OPENROUTER_API_KEY;
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

async function ownsActivity(activityId: string, userId: string) {
  const [row] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
    .limit(1);
  return Boolean(row);
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

  if (!(await ownsActivity(activityId, session.user.id))) {
    logger.warn("analysis.activity_not_found", { activityId });
    return new Response("Activity not found", { status: 404 });
  }

  // Only the run ids come from the request; the messages are built here.
  const params = await chatParamsFromRequest(request);
  const apiKey = env.OPENROUTER_API_KEY;
  const mocked = !apiKey;
  const adapter = apiKey
    ? createOpenRouterText(ANALYSIS_MODEL, apiKey, {
        httpReferer: env.BETTER_AUTH_URL,
        appTitle: APP_NAME,
      })
    : mockActivityAnalysisText();

  logger.info("analysis.start", { activityId, mocked, model: mocked ? "mock" : ANALYSIS_MODEL });

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
        model: mocked ? "mock" : ANALYSIS_MODEL,
      }),
    ),
  );
}
