import {
  isQualityKind,
  stepSecPerKm,
  type PlannedRun,
  type Step,
  type WrittenSession,
} from "./coach-plan.types.ts";
import {
  MAX_LONG_MINUTES,
  longestAllowedKm,
  maxLongShare,
  maxQualitySessions,
  longShareRuns,
  type RuleContext,
} from "./coach-plan-rules.ts";
import type { PaceRange, PaceType } from "./training-paces.types.ts";

/*
 * The mock coach's plan: written without a model under mock Strava, so local development and the
 * e2e suite see a plan with no OpenRouter key. Deterministic, and sized to pass every rule.
 */

/** Rounds down to half a km, so rounding never takes a run over a limit. */
const halfKm = (km: number) => Math.floor(km * 2) / 2;
/** Runs grow by this much a round; small enough for a 5 km week to reach 90 % of its budget. */
const STEP_KM = 0.1;
const tenth = (km: number) => Math.round(km * 10) / 10;
/** Room left under each limit, so the sizes VO2 works out from the steps stay inside it. */
const MARGIN = 0.95;

function step(part: Step["part"], km: number, pace: PaceType, withPaces: boolean): Step {
  const effort = pace === "easy" ? "easy" : "comfortablyHard";
  return {
    part,
    distanceM: Math.round(km * 1000),
    durationS: null,
    pace: withPaces ? pace : null,
    effort: withPaces ? null : effort,
  };
}

export function mockCoachPlan(
  ctx: RuleContext,
  paces: Record<PaceType, PaceRange> | null,
): WrittenSession[] {
  const { availability } = ctx;
  const withPaces = paces != null;
  const easySecPerKm = stepSecPerKm(step("work", 1, "easy", withPaces), paces);
  const kmIn = (minutes: number) => ((minutes * 60) / easySecPerKm) * MARGIN;
  const sessions: WrittenSession[] = [];
  // Earlier weeks' runs raise the longest-run limit of the weeks after them (rule 2).
  const planned: Pick<PlannedRun, "weekStart" | "distanceKm" | "kind">[] = [
    ...ctx.frozen,
    ...ctx.neighbours,
  ];

  for (const week of ctx.weeks.filter((item) => item.weekStart >= ctx.fromWeek)) {
    const frozen = ctx.frozen.filter((session) => session.weekStart === week.weekStart);
    const races = ctx.raceWeeks.filter((weekStart) => weekStart === week.weekStart).length;
    const frozenKm = frozen.reduce((sum, session) => sum + session.distanceKm, 0);
    const budget = week.budgetKm * 0.97 - frozenKm;
    // As many runs as the longest-run share is read for, so equal runs always pass it.
    const wanted = longShareRuns(week, ctx) - frozen.length;
    if (wanted <= 0) continue;

    // Grow every run by a tenth of a km a round, all together so no run outgrows the longest-run
    // share, until the budget or the longest-run rules (2 h 30, 10 % over the last 30 days) stop it.
    const share = maxLongShare(longShareRuns(week, ctx));
    const cap = Math.min(
      kmIn(MAX_LONG_MINUTES),
      longestAllowedKm(week.weekStart, ctx, planned).limit * MARGIN,
    );
    let size = Math.min(2, Math.floor(cap * 10) / 10);
    const total = (km: number) => frozenKm + km * wanted;
    while (total(size + STEP_KM) - frozenKm <= budget && size + STEP_KM <= cap) {
      if (size + STEP_KM > share * total(size + STEP_KM) + 0.01) break;
      size = tenth(size + STEP_KM);
    }
    if (size < 2) continue;

    // One threshold run when the week allows quality, has no race, and the runs are long enough.
    const qualityLeft =
      maxQualitySessions(availability.runsPerWeek) -
      frozen.filter((session) => isQualityKind(session.kind)).length -
      races;
    const tempo = qualityLeft > 0 && week.phase !== "recovery" && wanted > 1 && size >= 5;

    for (let index = 0; index < wanted; index += 1) {
      planned.push({ weekStart: week.weekStart, distanceKm: size, kind: "easy" });
      if (index === 0) {
        sessions.push({
          weekStart: week.weekStart,
          kind: "long",
          title: `${size} km long run`,
          why: "The long run builds the endurance your race needs.",
          blocks: [{ repeat: 1, steps: [step("work", size, "easy", withPaces)] }],
        });
        continue;
      }
      if (index === 1 && tempo) {
        const work = Math.max(1, Math.min(halfKm(week.budgetKm * 0.1), size - 3));
        const warmup = halfKm((size - work) / 2);
        sessions.push({
          weekStart: week.weekStart,
          kind: "tempo",
          title: `${work} km at threshold`,
          why: "Threshold running raises the pace you can hold for about an hour.",
          blocks: [
            {
              repeat: 1,
              steps: [
                step("warmup", warmup, "easy", withPaces),
                step("work", work, "threshold", withPaces),
                step("cooldown", tenth(size - work - warmup), "easy", withPaces),
              ],
            },
          ],
        });
        continue;
      }
      sessions.push({
        weekStart: week.weekStart,
        kind: "easy",
        title: `${size} km easy`,
        why: "Easy running adds volume while you recover from the harder runs.",
        blocks: [{ repeat: 1, steps: [step("work", size, "easy", withPaces)] }],
      });
    }
  }
  return sessions;
}
