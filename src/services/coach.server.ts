import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";
import {
  chat,
  chatParamsFromRequest,
  maxIterations,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { defineAIPersistence, reconstructChat, withPersistence } from "@tanstack/ai-persistence";
import { inlineSkill, withSkills } from "@tanstack/ai-skills";

import ridePrinciples from "@/coaching/cycling/principles.md?raw";
import rideSessions from "@/coaching/cycling/sessions.md?raw";
import rideZones from "@/coaching/cycling/zones.md?raw";
import paces from "@/coaching/running/paces.md?raw";
import principles from "@/coaching/running/principles.md?raw";
import sessions from "@/coaching/running/sessions.md?raw";
import season from "@/coaching/season.md?raw";

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
import { storedPlanningStyle } from "./athlete-settings.server.ts";
import { isBestEfforts } from "./best-efforts.ts";
import { downsampleStreams, measureActivity, type MeasureRequest } from "./coach-measure.ts";
import { chatOwnedByOther, coachChatPersistence } from "./coach-chats.server.ts";
import { mockCoachText } from "./coach-mock.ts";
import { coachKeyMissing, coachModelFor } from "./coach-model.server.ts";
import {
  applyPlanChange,
  coachPlanForCoach,
  proposePlanChange,
} from "./coach-plan-change.server.ts";
import { COACH_PLAN_CHANGE_PROMPT, COACH_SYSTEM_PROMPT } from "./coach-prompt.ts";
import {
  applyPlanChangeDef,
  correlateStreamsDef,
  findActivitiesDef,
  findClimbsDef,
  getActivityDef,
  getActivityStreamsDef,
  getAthleteProfileDef,
  getCoachPlanDef,
  getFitnessDef,
  getPersonalBestsDef,
  getSeasonDef,
  measureActivityDef,
  proposePlanChangeDef,
  showVisualDef,
  summarizeEffortPhasesDef,
} from "./coach-tools.ts";
import { loadHeartRateImpl } from "./heart-rate.server.ts";
import { loadBestsForUser } from "./personal-bests.server.ts";
import { topEfforts, type BestsPeriod } from "./personal-bests.ts";
import { seasonWeeks } from "./season-phase.ts";
import { loadSeasonImpl } from "./season.server.ts";
import { loadFitnessDataImpl } from "./training-load.server.ts";
import { buildPmc, dayKey, roundLoad, trainingPhase } from "./training-load.ts";

type CoachRuntime = { userId: string; timeZone: string };

/**
 * The running, cycling, and season knowledge the plan writer reads, loaded by the chat only when a
 * question needs it: about 8,000 words would tax every message. Portable skills run on the
 * athlete's OpenRouter model; hosted provider skills need Anthropic's or OpenAI's sandbox.
 */
const COACHING_SKILLS = [
  inlineSkill({
    name: "running-principles",
    description:
      "How VO2 builds a running week: the rules every coach plan is checked against, week templates by runs per week, intensity, the long run, season phases, missed sessions, and B and C races. Load before explaining how a week is built or proposing a plan change.",
    instructions: principles,
  }),
  inlineSkill({
    name: "running-paces",
    description:
      "The five running training paces: where VO2's paces come from, what each is for, how much running at each, and when to target an effort instead. Load before explaining a pace or how hard a session is.",
    instructions: paces,
  }),
  inlineSkill({
    name: "running-sessions",
    description:
      "The running sessions VO2 writes (easy, recovery, long, tempo, cruise intervals, intervals, repetitions, race pace, fartlek, hills, progression), their step format, and how to size them by level and goal. Load before explaining a session or writing one in a plan change.",
    instructions: sessions,
  }),
  inlineSkill({
    name: "cycling-principles",
    description:
      "How VO2 builds a riding week: the rules every coach plan's rides are checked against, week templates by rides per week, the long ride, fuelling, season phases, taper, indoor rides, and B and C events. Load before explaining how rides are planned or proposing a change to a ride.",
    instructions: ridePrinciples,
  }),
  inlineSkill({
    name: "cycling-zones",
    description:
      "The cycling zones rides target (recovery to sprint) as a share of FTP and of cycling LTHR, what each is for, and where FTP comes from. Load before explaining a ride's target or how hard it is.",
    instructions: rideZones,
  }),
  inlineSkill({
    name: "cycling-sessions",
    description:
      "The ride sessions VO2 writes (endurance, long, sweet spot, threshold, VO2 max, climbing, sprints), their step format, work by event type, and sizing by weekly hours. Load before explaining a ride or writing one in a plan change.",
    instructions: rideSessions,
  }),
  inlineSkill({
    name: "season-multisport",
    description:
      "How VO2 plans a season of runs and rides: which sport builds, how the other holds, the shared quality limit, B and C goals of the other sport, and triathlon and duathlon. Load before explaining how runs and rides share the week.",
    instructions: season,
  }),
];

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

/**
 * The chat reads the coach plan, and may change it only through a checked proposal the athlete
 * applies (ADR 0038). With planning off, the chat never gets these tools.
 */
function coachPlanTools() {
  return [
    getCoachPlanDef.server<CoachRuntime>((_input, { context }) =>
      coachPlanForCoach(context.userId),
    ),
    proposePlanChangeDef.server<CoachRuntime>((input, { context }) =>
      proposePlanChange(context.userId, input),
    ),
    applyPlanChangeDef.server<CoachRuntime>(({ proposalId }, { context }) =>
      applyPlanChange(context.userId, proposalId),
    ),
  ];
}

function createCoachTools(coachPlan: boolean) {
  return [
    ...(coachPlan ? coachPlanTools() : []),
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
    getSeasonDef.server<CoachRuntime>(async () => {
      const season = await loadSeasonImpl();
      const goals = season.upcoming.flatMap((event) => event.goals);
      const last = season.upcoming.at(-1)?.date;
      return {
        today: season.today,
        upcoming: season.upcoming,
        past: season.past,
        weeks: last ? seasonWeeks(goals, season.today, last) : [],
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

  const [coach, style] = await Promise.all([
    coachModelFor(session.user.id, "chat"),
    storedPlanningStyle(session.user.id),
  ]);
  if (coach.kind === "missing") return coachKeyMissing();
  const params = await chatParamsFromRequest(request);
  if (await chatOwnedByOther(session.user.id, params.threadId)) {
    return new Response("Not found", { status: 404 });
  }
  const timeZone = validTimeZone(params.forwardedProps.timeZone);
  const adapter = coach.kind === "mock" ? mockCoachText() : coach.adapter;
  const coachPlan = style === "coachPlan";

  logger.info("coach.start", {
    model: coach.model,
    messages: params.messages.length,
    resumed: Boolean(params.resume?.length),
  });

  const stream = chat({
    adapter,
    messages: params.messages,
    threadId: params.threadId,
    runId: params.runId,
    // The athlete's Apply or Decline on a plan change continues the paused run.
    parentRunId: params.parentRunId,
    resume: params.resume,
    tools: createCoachTools(coachPlan),
    context: { userId: session.user.id, timeZone } satisfies CoachRuntime,
    systemPrompts: [
      COACH_SYSTEM_PROMPT,
      ...(coachPlan ? [COACH_PLAN_CHANGE_PROMPT] : []),
      todayLine(timeZone),
    ],
    agentLoopStrategy: maxIterations(12),
    // The server keeps the chat, so the athlete can reopen it later on any device.
    // Snapshots while streaming keep what the coach had said if the athlete leaves mid-reply.
    middleware: [
      withSkills(COACHING_SKILLS),
      withPersistence(coachChatPersistence(session.user.id), { snapshotStreaming: true }),
    ],
  });

  return toServerSentEventsResponse(stream);
}

/** A chat as last saved, for the app to show when it opens it (TanStack AI hydration). */
export async function handleCoachChatHistory(request: Request) {
  const session = await getOptionalSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { messages, interrupts } = coachChatPersistence(session.user.id).stores;
  // No run store: the reply streams only to the request that asked, so a reload has no run to
  // join. A pending plan change is still offered again.
  return reconstructChat(defineAIPersistence({ stores: { messages, interrupts } }), request, {
    authorize: async (threadId) => !(await chatOwnedByOther(session.user.id, threadId)),
  });
}
