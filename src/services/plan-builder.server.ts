import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import {
  historyStats,
  planGoalsFrom,
  suggestedShape,
  type BuilderData,
  type PlanDraft,
  type PlanPreview,
  type SeasonCheck,
} from "./plan-builder.types.ts";
import { storedPlanningStyle } from "./athlete-settings.server.ts";
import { projectRaceDay, projectSeason, seasonPhase } from "./season-phase.ts";
import { goalsFor, seasonContext } from "./season.server.ts";
import { anchorEvent, seasonEvents } from "./season.types.ts";
import { getTrainingPlanForUser, saveTrainingPlanForUser } from "./training-plan.server.ts";
import { addDayKey, dayKey, weekStartKey, type TrainingPlan } from "./training-plan.types.ts";
import { forgetWeekPlan, reconcileSeason } from "./week-coach.server.ts";
import { planWeek } from "./week-plan.ts";
import { loadWeekTargetImpl } from "./week-target.server.ts";
import { summarizeWeek, weeklyTarget } from "./week-target.ts";

function clock(timeZone: string) {
  const now = new Date();
  return { now, today: dayKey(now, timeZone), weekStart: weekStartKey(now, timeZone) };
}

/** The builder's starting point: Season's upcoming goals and what the last 12 weeks say. */
export async function loadPlanBuilderImpl(timeZone: string): Promise<BuilderData> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const saved = await getTrainingPlanForUser(userId);
  const zone = saved?.timeZone ?? timeZone;
  const { today, weekStart } = clock(zone);
  const [rows, goals, context] = await Promise.all([
    db
      .select({
        startDate: activities.startDate,
        movingTime: activities.movingTime,
        sportType: activities.sportType,
        distance: activities.distance,
      })
      .from(activities)
      .where(eq(activities.userId, userId)),
    goalsFor(userId),
    seasonContext(userId, zone, weekStart),
  ]);
  const upcoming = goals
    .filter((goal) => goal.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const stats = historyStats(rows, weekStart, zone);
  return {
    today,
    weekStart,
    timeZone: zone,
    goals: upcoming,
    stats,
    fitness: { ctl: context.fitness.ctl, form: context.fitness.ctl - context.fitness.atl },
    suggested: suggestedShape(stats, upcoming),
    current: saved
      ? {
          restWeekdays: saved.restWeekdays,
          longWeekday: saved.longWeekday,
          doubleDays: saved.doubleDays,
          sports: saved.sports,
          baselineMinutes: saved.baselineMinutes,
        }
      : null,
  };
}

/** The plan a draft makes: built on Season's goals as they are now, starting this week. */
async function planFromDraft(userId: string, draft: PlanDraft): Promise<TrainingPlan> {
  const [saved, goals] = await Promise.all([getTrainingPlanForUser(userId), goalsFor(userId)]);
  const { weekStart } = clock(draft.timeZone);
  return {
    restWeekdays: [...draft.restWeekdays].sort((a, b) => a - b),
    longWeekday: draft.longWeekday,
    doubleDays: draft.doubleDays,
    sports: draft.sports,
    goals: planGoalsFrom(goals),
    startWeek: weekStart,
    baselineMinutes: draft.baselineMinutes,
    keySessionSports: saved?.keySessionSports ?? {},
    timeZone: draft.timeZone,
  };
}

/** The season map and this week as a draft would plan them, without saving anything. */
export async function previewPlanImpl(draft: PlanDraft): Promise<PlanPreview> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const plan = await planFromDraft(userId, draft);
  const { today, weekStart } = clock(plan.timeZone);
  const goals = goalsFor(userId);
  const [data, context, season] = await Promise.all([
    loadWeekTargetImpl(plan),
    seasonContext(userId, plan.timeZone, weekStart),
    goals,
  ]);
  const summary = summarizeWeek({ ...data, plan });
  const week = planWeek({ data: { ...data, plan }, summary, constraints: [], previous: null });

  const upcoming = seasonEvents(season.filter((goal) => goal.date >= today));
  const last = upcoming.at(-1)?.date ?? addDayKey(weekStart, 7 * 11);
  const projected = projectSeason(
    context.fitness,
    season,
    weekStart,
    addDayKey(last, 7),
    context.weekLoads,
  );
  const weeks = projected.map((item) => {
    const target = weeklyTarget({
      plan,
      season: item.phase,
      weekStartFitness: { ctl: item.ctl, atl: item.atl },
      loadPerHour: context.loadPerHour,
      weekStart: item.weekStart,
      recentAverageLoad: null,
    });
    return {
      weekStart: item.weekStart,
      kind: item.phase.kind,
      lighter: item.phase.lighter,
      hours: Math.round((target.minutes / 60) * 10) / 10,
    };
  });
  // This week is planned exactly; the projection would not know what is done already.
  if (weeks[0]) weeks[0].hours = Math.round((summary.target.minutes / 60) * 10) / 10;

  const anchor = anchorEvent(upcoming);
  const raceDayForm = anchor
    ? projectRaceDay(context.fitness, season, today, anchor.date, context.weekLoads).form
    : null;
  return { weeks, days: week.days, raceDayForm };
}

/** Saves the draft as the athlete's plan and plans the rest of this week from it. */
export async function startPlanImpl(draft: PlanDraft): Promise<TrainingPlan> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const plan = await planFromDraft(userId, draft);
  await saveTrainingPlanForUser(userId, plan);
  await forgetWeekPlan(userId, plan.startWeek!);
  logger.info("plan.started", {
    goals: plan.goals?.length ?? 0,
    phase: seasonPhase((plan.goals ?? []) as never, plan.startWeek!).kind,
    baseline: plan.baselineMinutes != null,
  });
  return plan;
}

/** Takes Season's goals into the plan, so the weeks they reshape are planned with them. */
export async function adaptPlanImpl(): Promise<TrainingPlan | null> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const [plan, goals] = await Promise.all([getTrainingPlanForUser(userId), goalsFor(userId)]);
  if (!plan) return null;
  const next = { ...plan, goals: planGoalsFrom(goals) };
  await saveTrainingPlanForUser(userId, next);
  await forgetWeekPlan(userId, clock(plan.timeZone).weekStart);
  logger.info("plan.adapted", { goals: goals.length });
  return next;
}

/** After a goal changes: take it in at once when no week changes, or say which weeks would. */
export async function checkSeasonImpl(): Promise<SeasonCheck> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const [plan, style] = await Promise.all([
    getTrainingPlanForUser(userId),
    storedPlanningStyle(userId),
  ]);
  // The week planner's saved plan sleeps while planning is off; Season changes wait for it.
  if (!plan || style === "off") return { hasPlan: false, impact: null, adopted: null };
  const { weekStart } = clock(plan.timeZone);
  const { impact, adopted } = await reconcileSeason(userId, plan, weekStart);
  if (adopted) await forgetWeekPlan(userId, weekStart);
  return { hasPlan: true, impact, adopted };
}
