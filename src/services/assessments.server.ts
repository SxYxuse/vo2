import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, activityStreams, athleteMetrics, fieldTests } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { ageFromBirthDate } from "./app-settings.types.ts";
import {
  ASSESSMENT_LOOKBACK_DAYS,
  assessmentStatuses,
  beepStageSpeedKmh,
  beepVo2maxMlKgMin,
  primaryMetric,
  ASSESSMENT_SESSIONS,
  testsForSportType,
  withHistoryDeltas,
  type ActivityFieldTest,
  type AssessmentHistoryRow,
  type AssessmentId,
  type AssessmentsData,
} from "./assessments.ts";
import {
  parseAssessmentResult,
  scoreBeepTest,
  scoreFtp20,
  scoreRunLthr,
  type AssessmentResult,
} from "./assessments-score.ts";
import { toFitnessLoad } from "./training-load.ts";
import { refreshTrainingLoadsForUser } from "./training-load.server.ts";
import { getTrainingPlanForUser } from "./training-plan.server.ts";
import { latestPmc } from "./training-plan.types.ts";

function isAssessmentId(value: string): value is AssessmentId {
  return value === "ftp-20" || value === "beep-test" || value === "run-lthr";
}

function sessionToView(row: {
  id: string;
  assessmentId: string;
  activityId: string | null;
  result: unknown;
  completedAt: Date | null;
  activityTitle?: string | null;
}): Omit<AssessmentHistoryRow, "delta"> | null {
  if (!isAssessmentId(row.assessmentId) || !row.completedAt) return null;
  const result = parseAssessmentResult(row.result);
  const metric = primaryMetric(row.assessmentId);
  return {
    id: row.id,
    activityId: row.activityId,
    activityTitle: row.activityTitle ?? null,
    completedAt: row.completedAt.toISOString(),
    result,
    primary: result[metric.key],
  };
}

async function loadHistory(userId: string): Promise<Record<AssessmentId, AssessmentHistoryRow[]>> {
  const rows = await db
    .select({
      id: fieldTests.id,
      assessmentId: fieldTests.assessmentId,
      activityId: fieldTests.activityId,
      result: fieldTests.result,
      completedAt: fieldTests.completedAt,
      activityTitle: activities.name,
    })
    .from(fieldTests)
    .leftJoin(activities, eq(activities.id, fieldTests.activityId))
    .where(and(eq(fieldTests.userId, userId), eq(fieldTests.status, "completed")))
    .orderBy(desc(fieldTests.completedAt));

  const grouped: Record<AssessmentId, Omit<AssessmentHistoryRow, "delta">[]> = {
    "ftp-20": [],
    "beep-test": [],
    "run-lthr": [],
  };
  for (const row of rows) {
    const parsed = sessionToView(row);
    if (!parsed || !isAssessmentId(row.assessmentId)) continue;
    grouped[row.assessmentId].push(parsed);
  }
  return {
    "ftp-20": withHistoryDeltas(grouped["ftp-20"]),
    "beep-test": withHistoryDeltas(grouped["beep-test"]),
    "run-lthr": withHistoryDeltas(grouped["run-lthr"]),
  };
}

async function ensureOpenSuggestions(userId: string, suggestedIds: AssessmentId[]) {
  if (!suggestedIds.length) return;
  const open = await db
    .select({ assessmentId: fieldTests.assessmentId })
    .from(fieldTests)
    .where(and(eq(fieldTests.userId, userId), eq(fieldTests.status, "suggested")));
  const have = new Set(open.map((row) => row.assessmentId));
  const now = new Date();
  const inserts = suggestedIds
    .filter((id) => !have.has(id))
    .map((assessmentId) => ({
      id: crypto.randomUUID(),
      userId,
      assessmentId,
      status: "suggested" as const,
      suggestedAt: now,
      updatedAt: now,
    }));
  if (inserts.length) {
    logger.info("assessments.suggestions_opened", {
      count: inserts.length,
      ids: inserts.map((row) => row.assessmentId),
    });
    await db.insert(fieldTests).values(inserts);
  }
}

export async function loadAssessmentsImpl(): Promise<AssessmentsData> {
  const session = await getOptionalSession();
  if (!session) {
    logger.debug("assessments.anonymous");
    return {
      signedIn: false,
      tsb: 0,
      tests: assessmentStatuses({ plan: null, tsb: 0, recentIds: [], age: null }),
    };
  }

  const since = new Date(Date.now() - ASSESSMENT_LOOKBACK_DAYS * 86_400_000);
  const [plan, profileRows, loadsRows, recentCompleted, history] = await Promise.all([
    getTrainingPlanForUser(session.user.id),
    db
      .select({ birthDate: athleteMetrics.birthDate })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, session.user.id))
      .limit(1),
    db
      .select({
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        trainingLoad: activities.trainingLoad,
        loadSource: activities.loadSource,
      })
      .from(activities)
      .where(eq(activities.userId, session.user.id)),
    db
      .select({ assessmentId: fieldTests.assessmentId })
      .from(fieldTests)
      .where(
        and(
          eq(fieldTests.userId, session.user.id),
          eq(fieldTests.status, "completed"),
          gte(fieldTests.completedAt, since),
        ),
      ),
    loadHistory(session.user.id),
  ]);
  const [profile] = profileRows;
  const age = ageFromBirthDate(profile?.birthDate ?? null);
  const timeZone = plan?.timeZone ?? "UTC";
  const loads = loadsRows.map((row) =>
    toFitnessLoad(
      row.startDate,
      row.trainingLoad ?? 0,
      row.loadSource ?? "duration",
      row.movingTime,
    ),
  );
  const pmc = latestPmc(loads, timeZone);
  const recentIds = recentCompleted.map((row) => row.assessmentId).filter(isAssessmentId);
  const tests = assessmentStatuses({ plan, tsb: pmc.tsb, recentIds, age, history });
  await ensureOpenSuggestions(
    session.user.id,
    tests.filter((test) => test.status === "suggested").map((test) => test.id),
  );

  logger.debug("assessments.loaded", { tsb: pmc.tsb, testCount: tests.length });
  return {
    signedIn: true,
    tsb: pmc.tsb,
    tests,
  };
}

export async function fieldTestForActivity(
  userId: string,
  activityId: string,
): Promise<ActivityFieldTest | null> {
  const [row] = await db
    .select({
      assessmentId: fieldTests.assessmentId,
      result: fieldTests.result,
    })
    .from(fieldTests)
    .where(and(eq(fieldTests.userId, userId), eq(fieldTests.activityId, activityId)))
    .limit(1);
  if (!row || !isAssessmentId(row.assessmentId)) return null;
  const title =
    ASSESSMENT_SESSIONS.find((test) => test.id === row.assessmentId)?.title ?? row.assessmentId;
  return {
    assessmentId: row.assessmentId,
    title,
    result: parseAssessmentResult(row.result),
  };
}

async function scoreActivity(
  activityId: string,
  assessmentId: AssessmentId,
  lastStage: number | null | undefined,
  age: number | null,
): Promise<AssessmentResult> {
  const [streams] = await db
    .select({
      time: activityStreams.time,
      heartrate: activityStreams.heartrate,
      watts: activityStreams.watts,
    })
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .limit(1);
  const time = streams?.time ?? null;
  const heartrate = streams?.heartrate ?? null;
  const watts = streams?.watts ?? null;
  if (assessmentId === "ftp-20") return scoreFtp20({ time, watts, heartrate });
  if (assessmentId === "run-lthr") return scoreRunLthr({ time, heartrate });
  return scoreBeepTest({
    time,
    heartrate,
    lastStage: lastStage ?? null,
    age,
    vo2max: beepVo2maxMlKgMin,
    stageSpeed: beepStageSpeedKmh,
  });
}

async function applyAthleteMetrics(
  userId: string,
  assessmentId: AssessmentId,
  result: AssessmentResult,
) {
  const [current] = await db
    .select({
      ftp: athleteMetrics.ftp,
      lthr: athleteMetrics.lthr,
      cyclingLthr: athleteMetrics.cyclingLthr,
      runLthr: athleteMetrics.runLthr,
      swimLthr: athleteMetrics.swimLthr,
      restHr: athleteMetrics.restHr,
    })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  const ftp =
    assessmentId === "ftp-20" ? (result.ftpWatts ?? current?.ftp ?? null) : (current?.ftp ?? null);
  const cyclingLthr =
    assessmentId === "ftp-20"
      ? (result.cyclingLthr ?? current?.cyclingLthr ?? current?.lthr ?? null)
      : (current?.cyclingLthr ?? current?.lthr ?? null);
  const runLthr =
    assessmentId === "run-lthr"
      ? (result.runLthr ?? current?.runLthr ?? null)
      : (current?.runLthr ?? null);
  const swimLthr = current?.swimLthr ?? null;
  const restHr = current?.restHr ?? null;
  await db
    .insert(athleteMetrics)
    .values({
      userId,
      ftp,
      lthr: cyclingLthr,
      cyclingLthr,
      runLthr,
      swimLthr,
      restHr,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: {
        ftp,
        lthr: cyclingLthr,
        cyclingLthr,
        runLthr,
        swimLthr,
        restHr,
        updatedAt: new Date(),
      },
    });
  void refreshTrainingLoadsForUser(userId).catch((error) => {
    logger.error("assessments.load_refresh_failed", { userId, error });
  });
}

export async function flagActivityTestImpl(input: {
  activityId: string;
  assessmentId: AssessmentId | null;
  lastStage?: number | null;
}): Promise<ActivityFieldTest | null> {
  const session = await getRequiredSession();
  const [activity] = await db
    .select({
      id: activities.id,
      sportType: activities.sportType,
    })
    .from(activities)
    .where(and(eq(activities.id, input.activityId), eq(activities.userId, session.user.id)))
    .limit(1);
  if (!activity) throw new Error("Activity not found");

  const allowed = testsForSportType(activity.sportType);
  if (input.assessmentId && !allowed.some((test) => test.id === input.assessmentId)) {
    throw new Error("That test is not available for this sport.");
  }

  const existingQuery = db
    .select({ id: fieldTests.id })
    .from(fieldTests)
    .where(and(eq(fieldTests.userId, session.user.id), eq(fieldTests.activityId, input.activityId)))
    .limit(1);

  if (!input.assessmentId) {
    const [existing] = await existingQuery;
    if (existing) {
      logger.info("assessments.unflagged", { activityId: input.activityId });
      await db.delete(fieldTests).where(eq(fieldTests.id, existing.id));
    }
    return null;
  }

  const assessmentId = input.assessmentId;
  const [[existing], [profile], [open]] = await Promise.all([
    existingQuery,
    db
      .select({ birthDate: athleteMetrics.birthDate })
      .from(athleteMetrics)
      .where(eq(athleteMetrics.userId, session.user.id))
      .limit(1),
    db
      .select({ id: fieldTests.id })
      .from(fieldTests)
      .where(
        and(
          eq(fieldTests.userId, session.user.id),
          eq(fieldTests.assessmentId, assessmentId),
          eq(fieldTests.status, "suggested"),
        ),
      )
      .limit(1),
  ]);
  const age = ageFromBirthDate(profile?.birthDate ?? null);
  const result = await scoreActivity(input.activityId, assessmentId, input.lastStage, age);
  const now = new Date();
  const catalogTitle = allowed.find((test) => test.id === assessmentId)?.title ?? assessmentId;

  const targetId = existing?.id ?? open?.id ?? crypto.randomUUID();
  if (existing && open && existing.id !== open.id) {
    await db.delete(fieldTests).where(eq(fieldTests.id, open.id));
  }

  await db
    .insert(fieldTests)
    .values({
      id: targetId,
      userId: session.user.id,
      assessmentId: input.assessmentId,
      status: "completed",
      activityId: input.activityId,
      result,
      suggestedAt: now,
      completedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fieldTests.id,
      set: {
        assessmentId: input.assessmentId,
        status: "completed",
        activityId: input.activityId,
        result,
        completedAt: now,
        updatedAt: now,
      },
    });

  await applyAthleteMetrics(session.user.id, input.assessmentId, result);
  logger.info("assessments.flagged", {
    activityId: input.activityId,
    assessmentId: input.assessmentId,
  });
  return { assessmentId: input.assessmentId, title: catalogTitle, result };
}
