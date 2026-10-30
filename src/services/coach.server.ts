import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";
import {
  chat,
  chatParamsFromRequest,
  maxIterations,
  toServerSentEventsResponse,
} from "@tanstack/ai";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession } from "@/lib/session.server.ts";
import { loadActivityAnalysisSnapshot } from "./activity-analysis.server.ts";
import {
  correlateStreams,
  detectElevationSegments,
  presentEffortForCoach,
  presentElevationForCoach,
  presentOverviewForCoach,
  summarizeEffort,
  type AnalysisStreamKey,
} from "./activity-analysis.types.ts";
import { isBestEfforts } from "./best-efforts.ts";
import { downsampleStreams, measureActivity, type MeasureRequest } from "./coach-measure.ts";
import { mockCoachText } from "./coach-mock.ts";
import { coachKeyMissing, coachModelFor } from "./coach-model.server.ts";
import { COACH_SYSTEM_PROMPT } from "./coach-prompt.ts";
import {
  correlateStreamsDef,
  findActivitiesDef,
  findClimbsDef,
  getActivityDef,
  getActivityStreamsDef,
  getAthleteProfileDef,
  getFitnessDef,
  getPersonalBestsDef,
  getSeasonDef,
  getWeekPlanDef,
  measureActivityDef,
  showVisualDef,
  summarizeEffortPhasesDef,
} from "./coach-tools.ts";
import { loadHeartRateImpl } from "./heart-rate.server.ts";
import { loadBestsForUser } from "./personal-bests.server.ts";
import { topEfforts, type BestsPeriod } from "./personal-bests.ts";
import { loadSeasonImpl } from "./season.server.ts";
import { loadFitnessDataImpl } from "./training-load.server.ts";
import { buildPmc, dayKey, roundLoad, trainingPhase } from "./training-load.ts";
import { loadWeekCoachImpl } from "./week-coach.server.ts";

type CoachRuntime = { userId: string; timeZone: string };

const DAY_MS = 86_400_000;
const MAX_FITNESS_DAYS = 180;

function validTimeZone(value: unknown) {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function round1(value: number | null | undefined) {
  return value == null ? null : Math.round(value * 10) / 10;
}

async function loadStreams(activityId: string, userId: string) {
  const [row] = await db
    .select({
      sportType: activities.sportType,
      time: activityStreams.time,
      distance: activityStreams.distance,
      heartrate: activityStreams.heartrate,
      altitude: activityStreams.altitude,
      watts: activityStreams.watts,
      cadence: activityStreams.cadence,
      velocitySmooth: activityStreams.velocitySmooth,
      gradeSmooth: activityStreams.gradeSmooth,
    })
    .from(activities)
    .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(and(eq(activities.id, activityId), eq(activities.userId, userId)))
    .limit(1);
  if (!row) throw new Error(`No activity ${activityId} in the athlete's local copy.`);
  return row;
}

function createCoachTools() {
  return [
    findActivitiesDef.server<CoachRuntime>(async (input, { context }) => {
      const { userId, timeZone } = context;
      // Pad the bounds by a day, then keep the days the athlete means in their own timezone.
      const conditions = [eq(activities.userId, userId)];
      if (input.from)
        conditions.push(gte(activities.startDate, new Date(Date.parse(input.from) - DAY_MS)));
      if (input.to)
        conditions.push(lte(activities.startDate, new Date(Date.parse(input.to) + 2 * DAY_MS)));
      if (input.sportType) conditions.push(eq(activities.sportType, input.sportType));
      if (input.nameContains) conditions.push(ilike(activities.name, `%${input.nameContains}%`));
      const rows = await db
        .select({
          id: activities.id,
          name: activities.name,
          sportType: activities.sportType,
          startDate: activities.startDate,
          movingTime: activities.movingTime,
          distance: activities.distance,
          totalElevationGain: activities.totalElevationGain,
          averageHeartrate: activities.averageHeartrate,
          averageWatts: activities.averageWatts,
          trainingLoad: activities.trainingLoad,
          streamsSyncedAt: activities.streamsSyncedAt,
        })
        .from(activities)
        .where(and(...conditions))
        .orderBy(desc(activities.startDate))
        .limit(500);
      const limit = input.limit ?? 20;
      const matches = rows.filter((row) => {
        const key = dayKey(row.startDate, timeZone);
        return (!input.from || key >= input.from) && (!input.to || key <= input.to);
      });
      return {
        total: matches.length,
        activities: matches.slice(0, limit).map((row) => ({
          id: row.id,
          name: row.name,
          sportType: row.sportType,
          day: dayKey(row.startDate, timeZone),
          start: row.startDate.toISOString(),
          movingTimeS: row.movingTime,
          distanceKm: round1(row.distance == null ? null : row.distance / 1000),
          elevationGainM:
            row.totalElevationGain == null ? null : Math.round(row.totalElevationGain),
          avgHeartrate: row.averageHeartrate == null ? null : Math.round(row.averageHeartrate),
          avgWatts: row.averageWatts == null ? null : Math.round(row.averageWatts),
          trainingLoad: row.trainingLoad == null ? null : roundLoad(row.trainingLoad),
          hasStreams: row.streamsSyncedAt != null,
        })),
      };
    }),
    getActivityDef.server<CoachRuntime>(async ({ activityId }, { context }) => {
      const [snapshot, [row]] = await Promise.all([
        loadActivityAnalysisSnapshot(activityId, context.userId),
        db
          .select({
            startDate: activities.startDate,
            trainingLoad: activities.trainingLoad,
            bestEfforts: activityStreams.bestEfforts,
          })
          .from(activities)
          .leftJoin(activityStreams, eq(activityStreams.activityId, activities.id))
          .where(and(eq(activities.id, activityId), eq(activities.userId, context.userId)))
          .limit(1),
      ]);
      return {
        id: activityId,
        day: row ? dayKey(row.startDate, context.timeZone) : null,
        start: row?.startDate.toISOString() ?? null,
        trainingLoad: row?.trainingLoad == null ? null : roundLoad(row.trainingLoad),
        bestEfforts: isBestEfforts(row?.bestEfforts) ? row.bestEfforts : null,
        ...presentOverviewForCoach(snapshot.overview),
      };
    }),
    measureActivityDef.server<CoachRuntime>(async (input, { context }) => {
      const row = await loadStreams(input.activityId, context.userId);
      let request: MeasureRequest;
      if (input.kind === "range") {
        if (input.end == null) return { measures: [], note: "A range needs `end`." };
        request = { kind: "range", unit: input.unit, start: input.start ?? 0, end: input.end };
      } else {
        if (input.length == null) return { measures: [], note: `${input.kind} needs \`length\`.` };
        request = { kind: input.kind, unit: input.unit, length: input.length };
      }
      return measureActivity(row, row.sportType, request);
    }),
    getActivityStreamsDef.server<CoachRuntime>(async (input, { context }) => {
      const row = await loadStreams(input.activityId, context.userId);
      return downsampleStreams(
        {
          ...row,
          speed: row.velocitySmooth?.map((metresPerSecond) => metresPerSecond * 3.6) ?? null,
          grade: row.gradeSmooth,
        },
        input.channels,
        input.points,
      );
    }),
    findClimbsDef.server<CoachRuntime>(async ({ activityId }, { context }) => {
      const snapshot = await loadActivityAnalysisSnapshot(activityId, context.userId);
      const { sportType } = snapshot.overview;
      return presentElevationForCoach(
        detectElevationSegments(snapshot.samples, sportType),
        sportType,
      );
    }),
    correlateStreamsDef.server<CoachRuntime>(async ({ activityId, pairs }, { context }) => {
      const snapshot = await loadActivityAnalysisSnapshot(activityId, context.userId);
      return correlateStreams(
        snapshot.samples,
        pairs as [AnalysisStreamKey, AnalysisStreamKey][] | undefined,
        snapshot.overview.sportType,
      );
    }),
    summarizeEffortPhasesDef.server<CoachRuntime>(async ({ activityId }, { context }) => {
      const snapshot = await loadActivityAnalysisSnapshot(activityId, context.userId);
      return presentEffortForCoach(summarizeEffort(snapshot.samples), snapshot.overview.sportType);
    }),
    getFitnessDef.server<CoachRuntime>(async (input, { context }) => {
      const data = await loadFitnessDataImpl();
      const pmc = buildPmc(data.fitnessLoads, context.timeZone);
      const to = input.to ?? dayKey(new Date(), context.timeZone);
      const from = input.from ?? new Date(Date.parse(to) - 41 * DAY_MS).toISOString().slice(0, 10);
      const days = pmc.filter((point) => point.date >= from && point.date <= to);
      return {
        phase: trainingPhase(pmc),
        days: days.slice(-MAX_FITNESS_DAYS).map((point) => ({
          day: point.date,
          load: roundLoad(point.load),
          fitness: round1(point.ctl),
          fatigue: round1(point.atl),
          form: round1(point.tsb),
        })),
      };
    }),
    getPersonalBestsDef.server<CoachRuntime>(async (input, { context }) => {
      const data = await loadBestsForUser(context.userId);
      const period = (input.period ?? "all") as BestsPeriod;
      const boards = data.boards.filter((board) => !input.sport || board.sport === input.sport);
      return {
        period,
        weightKg: data.weightKg,
        boards: boards
          .map((board) => ({
            sport: board.sport,
            kind: board.kind,
            key: board.key,
            unit: board.kind === "power" ? "watts" : board.kind === "time" ? "seconds" : "metres",
            top: topEfforts(board, data.activities, period, new Date(), 3).map((effort) => ({
              rank: effort.rank,
              value: effort.value,
              activity: effort.activity,
            })),
          }))
          .filter((board) => board.top.length),
      };
    }),
    getWeekPlanDef.server<CoachRuntime>(async () => {
      const state = await loadWeekCoachImpl();
      return {
        weekStart: state.weekStart,
        days: state.plan?.days ?? [],
        note: state.plan?.note ?? null,
        droppedKeySessions: state.plan?.dropped ?? [],
        coachNotes: state.notes,
      };
    }),
    getSeasonDef.server<CoachRuntime>(async () => {
      const season = await loadSeasonImpl();
      return {
        today: season.today,
        upcoming: season.upcoming,
        past: season.past,
        weeks: season.map,
      };
    }),
    getAthleteProfileDef.server<CoachRuntime>(async (_input, { context }) => {
      const [heartRate, [metrics]] = await Promise.all([
        loadHeartRateImpl(),
        db
          .select({ ftp: athleteMetrics.ftp, weightKg: athleteMetrics.weightKg })
          .from(athleteMetrics)
          .where(eq(athleteMetrics.userId, context.userId))
          .limit(1),
      ]);
      return {
        ftp: metrics?.ftp == null ? null : Math.round(metrics.ftp),
        weightKg: metrics?.weightKg ?? null,
        heartRate: heartRate.sports.map((sport) => ({
          sportType: sport.sportType,
          family: sport.family,
          zoneMethod: sport.zoneMethod,
          maxHeartrate: sport.maxHeartrate,
          lthr: sport.lthr,
          restHr: sport.restHr,
          zones: sport.zones.map(({ id, minBpm, maxBpm }) => ({ id, minBpm, maxBpm })),
        })),
      };
    }),
    // The visual is drawn from the call's input on the athlete's screen; the coach only learns
    // that it was shown.
    showVisualDef.server<CoachRuntime>(async () => ({ shown: true })),
  ];
}

function todayLine(timeZone: string) {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(now);
  return `Today is ${weekday} ${dayKey(now, timeZone)} in the athlete's timezone (${timeZone}).`;
}

export async function handleCoachChat(request: Request) {
  const session = await getOptionalSession();
  if (!session) {
    logger.warn("coach.unauthorized");
    return new Response("Unauthorized", { status: 401 });
  }

  const coach = await coachModelFor(session.user.id, "chat");
  if (coach.kind === "missing") return coachKeyMissing();
  const params = await chatParamsFromRequest(request);
  const timeZone = validTimeZone(params.forwardedProps.timeZone);
  const adapter = coach.kind === "mock" ? mockCoachText() : coach.adapter;

  logger.info("coach.start", { model: coach.model, messages: params.messages.length });

  const stream = chat({
    adapter,
    messages: params.messages,
    threadId: params.threadId,
    runId: params.runId,
    tools: createCoachTools(),
    context: { userId: session.user.id, timeZone } satisfies CoachRuntime,
    systemPrompts: [COACH_SYSTEM_PROMPT, todayLine(timeZone)],
    agentLoopStrategy: maxIterations(12),
  });

  return toServerSentEventsResponse(stream);
}
