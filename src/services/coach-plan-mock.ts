import {
  dayMinutes,
  isQualityKind,
  stepSecPerKm,
  type Step,
  type WrittenSession,
} from "./coach-plan.types.ts";
import {
  MAX_LONG_MINUTES,
  maxLongShare,
  maxQualitySessions,
  longShareRuns,
  type RuleContext,
} from "./coach-plan-rules.ts";
import { addDayKey } from "./day-key.ts";
import type { PaceRange, PaceType } from "./training-paces.types.ts";

/*
 * The mock coach's plan: written without a model under mock Strava, so local development and the
 * e2e suite see a plan with no OpenRouter key. Deterministic, and sized to pass every rule.
 */

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
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

/** Spread picks: the long run day first, then days not next to one already picked. */
function pickDays(candidates: string[], count: number, longDate: string | null) {
  const picked = longDate ? [longDate] : [];
  const near = (date: string) =>
    picked.some((other) => Math.abs(Date.parse(other) - Date.parse(date)) <= 86_400_000);
  for (const pass of [true, false]) {
    for (const date of candidates) {
      if (picked.length >= count) break;
      if (picked.includes(date) || (pass && near(date))) continue;
      picked.push(date);
    }
  }
  return picked.sort();
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
  const planned = [...ctx.frozen, ...ctx.neighbours].filter(
    (session) => session.date >= ctx.today && session.kind !== "race",
  );
  const history = [
    ...ctx.runs.filter((run) => run.date < ctx.today),
    ...planned.map((session) => ({ date: session.date, km: session.distanceKm })),
  ];
  const spikeLimit = (date: string) => {
    const since = addDayKey(date, -30);
    const longest = Math.max(
      5,
      ...history.filter((run) => run.date >= since && run.date < date).map((run) => run.km),
    );
    return longest * 1.1 * MARGIN;
  };
  const busy = new Set([...ctx.frozen.map((session) => session.date), ...ctx.raceDays]);
  const hardDays = new Set([
    ...[...ctx.frozen, ...ctx.neighbours]
      .filter((session) => isQualityKind(session.kind))
      .map((session) => session.date),
    ...ctx.raceDays,
  ]);

  for (const week of ctx.weeks) {
    const dates = Array.from({ length: 7 }, (_, index) => addDayKey(week.weekStart, index));
    const frozen = ctx.frozen.filter((session) => dates.includes(session.date));
    const races = ctx.raceDays.filter((date) => dates.includes(date));
    const candidates = dates.filter(
      (date) =>
        date >= ctx.from && !busy.has(date) && dayMinutes(availability, weekday(date)) != null,
    );
    // The long run never follows a hard day; easy runs may.
    const longDate =
      candidates.find(
        (date) => weekday(date) === availability.longRunDay && !hardDays.has(addDayKey(date, -1)),
      ) ?? null;
    const frozenKm = frozen.reduce((sum, session) => sum + session.distanceKm, 0);
    const budget = week.budgetKm * 0.97 - frozenKm;
    // As many runs as the longest-run share is read for, so equal runs always pass it.
    const wanted = longShareRuns(week, ctx) - frozen.length;
    const picked = pickDays(candidates, wanted, longDate);
    if (!picked.length) continue;

    // Grow every run by a tenth of a km a round, all together so no run outgrows the longest-run share,
    // until the budget, a day's time, or the longest-run rule stops it.
    const share = maxLongShare(longShareRuns(week, ctx));
    const cap = (date: string) => {
      const minutes = dayMinutes(availability, weekday(date))!;
      const time = date === longDate ? Math.min(MAX_LONG_MINUTES, minutes) : minutes;
      return Math.min(kmIn(time), spikeLimit(date));
    };
    const sizes = new Map(
      picked.map((date) => [date, Math.min(2, Math.floor(cap(date) * 10) / 10)]),
    );
    const sum = () => frozenKm + [...sizes.values()].reduce((total, km) => total + km, 0);
    const growing = new Set(picked);
    while (growing.size) {
      for (const date of growing) {
        if (sum() - frozenKm + STEP_KM > budget || sizes.get(date)! + STEP_KM > cap(date)) {
          growing.delete(date);
          continue;
        }
        sizes.set(date, tenth(sizes.get(date)! + STEP_KM));
      }
      for (const date of picked) {
        if (sizes.get(date)! <= share * sum() + 0.01) continue;
        sizes.set(date, tenth(sizes.get(date)! - STEP_KM));
        growing.delete(date);
      }
    }

    // One threshold run when the week allows quality and has no race: on a day with no hard day
    // or long run after it.
    const qualityLeft =
      maxQualitySessions(availability.runsPerWeek) -
      frozen.filter((session) => isQualityKind(session.kind)).length -
      races.length;
    const tempoDate =
      qualityLeft > 0 && week.phase !== "recovery"
        ? picked.find(
            (date) =>
              date !== longDate &&
              (sizes.get(date) ?? 0) >= 5 &&
              addDayKey(date, 1) !== longDate &&
              !hardDays.has(addDayKey(date, 1)) &&
              !hardDays.has(addDayKey(date, -1)),
          )
        : undefined;

    for (const date of picked) {
      const km = sizes.get(date) ?? 0;
      if (km < 2) continue;
      history.push({ date, km });
      if (date === tempoDate) {
        const work = Math.max(1, Math.min(halfKm(week.budgetKm * 0.1), km - 3));
        const warmup = halfKm((km - work) / 2);
        hardDays.add(date);
        sessions.push({
          date,
          kind: "tempo",
          key: true,
          title: `${work} km at threshold`,
          why: "Threshold running raises the pace you can hold for about an hour.",
          blocks: [
            {
              repeat: 1,
              steps: [
                step("warmup", warmup, "easy", withPaces),
                step("work", work, "threshold", withPaces),
                step("cooldown", Math.round((km - work - warmup) * 10) / 10, "easy", withPaces),
              ],
            },
          ],
        });
        continue;
      }
      const long = date === longDate;
      sessions.push({
        date,
        kind: long ? "long" : "easy",
        key: long,
        title: long ? `${km} km long run` : `${km} km easy`,
        why: long
          ? "The long run builds the endurance your race needs."
          : "Easy running adds volume while you recover from the harder days.",
        blocks: [{ repeat: 1, steps: [step("work", km, "easy", withPaces)] }],
      });
    }
  }
  return sessions;
}
