import { and, eq } from "drizzle-orm";
import {
  chat,
  chatParamsFromRequest,
  EventType,
  maxIterations,
  toServerSentEventsResponse,
  type StreamChunk,
} from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

import { serverEnv } from "#/configs/env.ts";
import { db } from "#/db/index.ts";
import { activities, activityAnalyses, activityStreams, athleteMetrics } from "#/db/schema.ts";
import { APP_NAME } from "#/lib/brand.ts";
import { logger } from "#/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "#/lib/session.server.ts";
import { mockActivityAnalysisText } from "./activity-analysis-mock.ts";
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
  summarizeEffort,
  type ActivityAnalysisSnapshot,
  type AnalysisStreamKey,
  type StoredActivityAnalysis,
} from "./activity-analysis.types.ts";

const ANALYSIS_MODEL = "openai/gpt-6-luna";
const MIN_SAVED_CHARS = 24;

export type AnalysisRuntime = {
  activityId: string;
  snapshot: () => Promise<ActivityAnalysisSnapshot>;
};

async function loadActivityAnalysisSnapshot(activityId: string, userId: string) {
  const [row] = await db
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
    .limit(1);

  if (!row) throw new Error("Activity not found");

  const [metrics] = await db
    .select({ ftp: athleteMetrics.ftp, lthr: athleteMetrics.lthr })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);

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
      athlete: { ftp: metrics?.ftp ?? null, lthr: metrics?.lthr ?? null },
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
      return snapshot.overview;
    }),
    detectElevationSegmentsDef.server<AnalysisRuntime>(async (_input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      return detectElevationSegments(snapshot.samples, snapshot.overview.sportType);
    }),
    correlateStreamsDef.server<AnalysisRuntime>(async (input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      const pairs = input.pairs as [AnalysisStreamKey, AnalysisStreamKey][] | undefined;
      return correlateStreams(snapshot.samples, pairs, snapshot.overview.sportType);
    }),
    summarizeEffortPhasesDef.server<AnalysisRuntime>(async (_input, ctx) => {
      const snapshot = await ctx.context.snapshot();
      return summarizeEffort(snapshot.samples);
    }),
  ];
}

export function isAnalysisMocked() {
  return !serverEnv.openRouterApiKey();
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

export async function saveActivityAnalysisImpl(input: {
  activityId: string;
  body: string;
  userId?: string;
  mocked?: boolean;
  model?: string | null;
}): Promise<StoredActivityAnalysis | null> {
  const body = input.body.trim();
  if (body.length < MIN_SAVED_CHARS) return null;
  const userId = input.userId ?? (await getRequiredSession()).user.id;
  const [owned] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, input.activityId), eq(activities.userId, userId)))
    .limit(1);
  if (!owned) return null;

  const mocked = input.mocked ?? isAnalysisMocked();
  const model = input.model ?? (mocked ? "mock" : ANALYSIS_MODEL);
  const now = new Date();
  const [row] = await db
    .insert(activityAnalyses)
    .values({
      activityId: input.activityId,
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
    })
    .returning({
      activityId: activityAnalyses.activityId,
      body: activityAnalyses.body,
      mocked: activityAnalyses.mocked,
      model: activityAnalyses.model,
      updatedAt: activityAnalyses.updatedAt,
    });
  if (!row) return null;
  logger.info("analysis.saved", {
    activityId: row.activityId,
    mocked: row.mocked,
    model: row.model,
    chars: row.body.length,
  });
  return {
    activityId: row.activityId,
    body: row.body,
    mocked: row.mocked,
    model: row.model,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function chunkTextDelta(chunk: StreamChunk) {
  if (chunk.type !== EventType.TEXT_MESSAGE_CONTENT) return "";
  if (!("delta" in chunk) || typeof chunk.delta !== "string") return "";
  return chunk.delta;
}

async function* persistCompletedAnalysis(
  stream: AsyncIterable<StreamChunk>,
  input: { activityId: string; userId: string; mocked: boolean; model: string },
) {
  let body = "";
  try {
    for await (const chunk of stream) {
      yield chunk;
      body += chunkTextDelta(chunk);
      if (chunk.type === EventType.TEXT_MESSAGE_END && body.trim().length >= MIN_SAVED_CHARS) {
        await saveActivityAnalysisImpl({ ...input, body });
      }
    }
  } finally {
    if (body.trim().length >= MIN_SAVED_CHARS) {
      await saveActivityAnalysisImpl({ ...input, body });
    }
  }
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

  const params = await chatParamsFromRequest(request);
  const apiKey = serverEnv.openRouterApiKey();
  const mocked = !apiKey;
  const adapter = apiKey
    ? createOpenRouterText(ANALYSIS_MODEL, apiKey, {
        httpReferer: serverEnv.betterAuthUrl(),
        appTitle: APP_NAME,
      })
    : mockActivityAnalysisText();

  logger.info("analysis.start", { activityId, mocked, model: mocked ? "mock" : ANALYSIS_MODEL });

  const stream = chat({
    adapter,
    messages: params.messages,
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
    persistCompletedAnalysis(stream, {
      activityId,
      userId: session.user.id,
      mocked,
      model: mocked ? "mock" : ANALYSIS_MODEL,
    }),
  );
}
