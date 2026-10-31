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
  const history = [
    ...ctx.runs.filter((run) => run.date < ctx.today),
    ...ctx.frozen
      .filter((session) => session.date >= ctx.today)
      .map((session) => ({ date: session.date, km: session.distanceKm })),
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
    ...ctx.frozen.filter((session) => isQualityKind(session.kind)).map((session) => session.date),
    ...ctx.raceDays,
  ]);

  for (const week of ctx.weeks) {
    const dates = Array.from({ length: 7 }, (_, index) => addDayKey(week.weekStart, index));
    const frozen = ctx.frozen.filter((session) => dates.includes(session.date));
    const races = ctx.raceDays.filter((date) => dates.includes(date));
    const candidates = dates.filter(
      (date) =>
        date >= ctx.from &&
        !busy.has(date) &&
        dayMinutes(availability, weekday(date)) != null &&
        !hardDays.has(addDayKey(date, -1)),
    );
    const longDate = candidates.find((date) => weekday(date) === availability.longRunDay) ?? null;
    const frozenKm = frozen.reduce((sum, session) => sum + session.distanceKm, 0);
    const budget = week.budgetKm * MARGIN - frozenKm;
    // Fewer, longer runs when the budget is small: none under about 3 km.
    const wanted = Math.min(availability.runsPerWeek - frozen.length, Math.floor(budget / 3));
    const picked = pickDays(candidates, Math.max(1, wanted), longDate);
    if (!picked.length || budget < 2) continue;

    const share = maxLongShare(picked.length + frozen.length);
    const others = picked.filter((date) => date !== longDate);
    const longWanted = picked.includes(longDate ?? "") ? budget * Math.min(1, share) : 0;
    const each = (budget - longWanted) / Math.max(1, others.length);
    const sizes = new Map<string, number>();
    for (const date of others) {
      const minutes = dayMinutes(availability, weekday(date))!;
      sizes.set(date, halfKm(Math.min(each, kmIn(minutes), spikeLimit(date))));
    }
    const othersKm = [...sizes.values()].reduce((sum, km) => sum + km, 0);
    if (longDate) {
      const minutes = Math.min(MAX_LONG_MINUTES, dayMinutes(availability, weekday(longDate))!);
      const byShare =
        share >= 1 ? Number.POSITIVE_INFINITY : ((frozenKm + othersKm) * share) / (1 - share);
      sizes.set(
        longDate,
        halfKm(Math.min(budget - othersKm, kmIn(minutes), spikeLimit(longDate), byShare)),
      );
    }

    // One threshold run when the week allows quality and has no race: on a day with no hard day
    // or long run after it.
    const qualityLeft =
      maxQualitySessions(availability.runsPerWeek) -
      frozen.filter((session) => isQualityKind(session.kind)).length -
      races.length;
    const tempoDate =
      qualityLeft > 0 && week.phase !== "recovery"
        ? others.find(
            (date) =>
              (sizes.get(date) ?? 0) >= 5 &&
              addDayKey(date, 1) !== longDate &&
              !hardDays.has(addDayKey(date, 1)),
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
