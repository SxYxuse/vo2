import {
  budgetOf,
  isQualityKind,
  metresText,
  minutesText,
  sessionAmount,
  plannedSports,
  sessionsPerWeek,
  stepSecPerKm,
  type PlanSport,
  type PlannedSession,
  type Step,
  type WrittenSession,
} from "./coach-plan.types.ts";
import {
  MAX_LONG_MINUTES,
  MAX_LONG_RIDE_MINUTES,
  MAX_LONG_SWIM_MINUTES,
  MAX_QUALITY_ACROSS_SPORTS,
  longShareCount,
  longestAllowed,
  maxLongRideShare,
  maxLongShare,
  maxQualitySessions,
  type RuleContext,
} from "./coach-plan-rules.ts";
import type { PaceRange, PaceType } from "./training-paces.types.ts";

/*
 * The mock coach's plan: written without a model under mock Strava, so local development and the
 * e2e suite see a plan with no OpenRouter key. Deterministic, and sized to pass every rule.
 */

/** Rounds down to half a km, so rounding never takes a run over a limit. */
const halfKm = (km: number) => Math.floor(km * 2) / 2;
const tenth = (km: number) => Math.round(km * 10) / 10;
/** Room left under each limit, so the sizes VO2 works out from the steps stay inside it. */
const MARGIN = 0.95;

function runStep(
  part: Step["part"],
  km: number,
  pace: PaceType,
  paces: Record<PaceType, PaceRange> | null,
): Step {
  const effort = pace === "easy" ? "easy" : "comfortablyHard";
  const range = paces?.[pace];
  return {
    part,
    distanceM: Math.round(km * 1000),
    durationS: null,
    pace: paces ? pace : null,
    // A harder pace names one pace inside its range, as the coach must (ADR 0055).
    secPerKm:
      range && pace !== "easy" ? Math.round((range.fastSecPerKm + range.slowSecPerKm) / 2) : null,
    zone: null,
    effort: paces ? null : effort,
  };
}

function rideStep(part: Step["part"], minutes: number, zone: Step["zone"]): Step {
  return {
    part,
    distanceM: null,
    durationS: minutes * 60,
    pace: null,
    secPerKm: null,
    zone,
    effort: null,
  };
}

/** A swim step: metres at a zone, or rest at the wall when `restS` is given. */
function swimStep(part: Step["part"], metres: number, zone: Step["zone"], restS?: number): Step {
  return {
    part,
    distanceM: restS == null ? metres : null,
    durationS: restS ?? null,
    pace: null,
    secPerKm: null,
    zone: restS == null ? zone : null,
    effort: restS == null ? null : "easy",
  };
}

/** Per sport: the step it grows by, its smallest session, its share, and how quality sizes. */
const MOCK = {
  run: { step: 0.1, start: 2, round: tenth, share: maxLongShare, minQuality: 5 },
  ride: {
    step: 5,
    start: 45,
    round: (minutes: number) => Math.round(minutes),
    share: maxLongRideShare,
    minQuality: 55,
  },
  swim: {
    step: 100,
    start: 1000,
    round: (metres: number) => Math.round(metres),
    share: maxLongRideShare,
    minQuality: 1500,
  },
} as const satisfies Record<PlanSport, unknown>;

export function mockCoachPlan(
  ctx: RuleContext,
  paces: Record<PaceType, PaceRange> | null,
): WrittenSession[] {
  const easySecPerKm = stepSecPerKm(runStep("work", 1, "easy", paces), paces);
  /** The longest session's time cap, in the sport's unit, a little under it. */
  const timeCapOf = (sport: PlanSport) => {
    if (sport === "run") return ((MAX_LONG_MINUTES * 60) / easySecPerKm) * MARGIN;
    if (sport === "swim") return ((MAX_LONG_SWIM_MINUTES * 60) / ctx.easySecPer100m) * 100 * MARGIN;
    return MAX_LONG_RIDE_MINUTES;
  };
  const sessions: WrittenSession[] = [];
  // Earlier weeks' sessions raise the longest-session limit of the weeks after them (rule 2).
  const planned: Pick<PlannedSession, "weekStart" | "distanceKm" | "minutes" | "kind" | "sport">[] =
    [...ctx.frozen, ...ctx.neighbours];

  for (const week of ctx.weeks.filter((item) => item.weekStart >= ctx.fromWeek)) {
    const races = ctx.races.filter((race) => race.weekStart === week.weekStart);
    let quality =
      races.filter((race) => race.effort !== "fun").length +
      ctx.frozen.filter((s) => s.weekStart === week.weekStart && isQualityKind(s.kind)).length;
    for (const sport of plannedSports(ctx.availability)) {
      const mock = MOCK[sport];
      const frozen = ctx.frozen.filter(
        (session) => session.weekStart === week.weekStart && session.sport === sport,
      );
      const frozenAmount = frozen.reduce((sum, session) => sum + sessionAmount(session), 0);
      const budget = budgetOf(week, sport) * 0.97 - frozenAmount;
      // As many sessions as the longest-session share is read for, so equal ones always pass it.
      const wanted = longShareCount(week, ctx, sport) - frozen.length;
      if (wanted <= 0) continue;

      // Grow every session a step a round, all together so none outgrows the longest-session
      // share, until the budget or the longest-session rules (time cap, rule 2) stop it.
      const share = mock.share(longShareCount(week, ctx, sport));
      const cap = Math.min(
        timeCapOf(sport),
        longestAllowed(week.weekStart, sport, ctx, planned).limit * MARGIN,
      );
      let size = Math.min(
        mock.start,
        sport === "run" ? Math.floor(cap * 10) / 10 : Math.floor(cap),
      );
      const total = (amount: number) => frozenAmount + amount * wanted;
      while (total(size + mock.step) - frozenAmount <= budget && size + mock.step <= cap) {
        if (size + mock.step > share * total(size + mock.step) + 0.01) break;
        size = mock.round(size + mock.step);
      }
      if (size < mock.start) continue;

      // One quality session when the sport and the week allow it, no steady race of the sport
      // keeps the week easy, and the sessions are long enough.
      const sportRaces = races.filter((race) => race.sport === sport);
      const sportQuality =
        sportRaces.filter((race) => race.effort !== "fun").length +
        frozen.filter((session) => isQualityKind(session.kind)).length;
      const canQuality =
        !sportRaces.some((race) => race.effort === "steady") &&
        sportQuality < maxQualitySessions(sessionsPerWeek(ctx.availability, sport)) &&
        quality < MAX_QUALITY_ACROSS_SPORTS &&
        week.phase !== "recovery" &&
        wanted > 1 &&
        size >= mock.minQuality;
      if (canQuality) quality += 1;

      for (let index = 0; index < wanted; index += 1) {
        planned.push({
          weekStart: week.weekStart,
          distanceKm: sport === "run" ? size : sport === "swim" ? size / 1000 : 0,
          minutes: sport === "ride" ? size : 0,
          kind: "easy",
          sport,
        });
        sessions.push(
          sport === "run"
            ? mockRun(week.weekStart, index, size, canQuality, week.budgetKm, paces)
            : sport === "ride"
              ? mockRide(week.weekStart, index, size, canQuality)
              : mockSwim(week.weekStart, index, size, canQuality),
        );
      }
    }
  }
  return sessions;
}

function mockRun(
  weekStart: string,
  index: number,
  size: number,
  quality: boolean,
  budgetKm: number,
  paces: Record<PaceType, PaceRange> | null,
): WrittenSession {
  const base = { weekStart, sport: "run" as PlanSport };
  if (index === 0) {
    return {
      ...base,
      kind: "long",
      title: `${size} km long run`,
      why: "The long run builds the endurance your race needs.",
      blocks: [{ repeat: 1, steps: [runStep("work", size, "easy", paces)] }],
    };
  }
  if (index === 1 && quality) {
    const work = Math.max(1, Math.min(halfKm(budgetKm * 0.1), size - 3));
    const warmup = halfKm((size - work) / 2);
    return {
      ...base,
      kind: "tempo",
      title: `${work} km at threshold`,
      why: "Threshold running raises the pace you can hold for about an hour.",
      blocks: [
        {
          repeat: 1,
          steps: [
            runStep("warmup", warmup, "easy", paces),
            runStep("work", work, "threshold", paces),
            runStep("cooldown", tenth(size - work - warmup), "easy", paces),
          ],
        },
      ],
    };
  }
  return {
    ...base,
    kind: "easy",
    title: `${size} km easy`,
    why: "Easy running adds volume while you recover from the harder runs.",
    blocks: [{ repeat: 1, steps: [runStep("work", size, "easy", paces)] }],
  };
}

function mockRide(
  weekStart: string,
  index: number,
  size: number,
  quality: boolean,
): WrittenSession {
  const base = { weekStart, sport: "ride" as PlanSport };
  if (index === 0) {
    return {
      ...base,
      kind: "long",
      title: `${minutesText(size)} long ride`,
      why: "The long ride builds the endurance your season needs. Eat about 60 g of carbs an hour.",
      blocks: [{ repeat: 1, steps: [rideStep("work", size, "endurance")] }],
    };
  }
  if (index === 1 && quality) {
    // 15 min warm-up, 2 × (12 min sweet spot, 5 min easy), and the rest easy.
    return {
      ...base,
      kind: "sweetSpot",
      title: "2 × 12 min sweet spot",
      why: "Sweet spot raises your threshold power at a cost you recover from quickly.",
      blocks: [
        { repeat: 1, steps: [rideStep("warmup", 15, "endurance")] },
        {
          repeat: 2,
          steps: [rideStep("work", 12, "sweetSpot"), rideStep("recovery", 5, "recovery")],
        },
        { repeat: 1, steps: [rideStep("cooldown", size - 49, "endurance")] },
      ],
    };
  }
  return {
    ...base,
    kind: "easy",
    title: `${minutesText(size)} endurance ride`,
    why: "Steady endurance riding adds aerobic volume at little cost.",
    blocks: [{ repeat: 1, steps: [rideStep("work", size, "endurance")] }],
  };
}

function mockSwim(
  weekStart: string,
  index: number,
  size: number,
  quality: boolean,
): WrittenSession {
  const base = { weekStart, sport: "swim" as PlanSport };
  if (index === 0) {
    return {
      ...base,
      kind: "long",
      title: `${metresText(size)} long swim`,
      why: "A long, steady swim builds the endurance to hold your stroke to the end of the race.",
      blocks: [{ repeat: 1, steps: [swimStep("work", size, "endurance")] }],
    };
  }
  if (index === 1 && quality) {
    // 400 m warm-up, 100 m repeats at CSS with 15 s rest, and the rest easy.
    const repeats = Math.floor((size - 600) / 100);
    return {
      ...base,
      kind: "tempo",
      title: `${repeats} × 100 m at CSS`,
      why: "Repeats at your threshold pace raise the speed you can hold over a race.",
      blocks: [
        { repeat: 1, steps: [swimStep("warmup", 400, "endurance")] },
        {
          repeat: repeats,
          steps: [swimStep("work", 100, "threshold"), swimStep("recovery", 0, null, 15)],
        },
        { repeat: 1, steps: [swimStep("cooldown", size - 400 - repeats * 100, "recovery")] },
      ],
    };
  }
  return {
    ...base,
    kind: "easy",
    title: `${metresText(size)} endurance swim`,
    why: "Steady swimming adds aerobic volume and grooves your stroke.",
    blocks: [{ repeat: 1, steps: [swimStep("work", size, "endurance")] }],
  };
}
