import type { FuelProduct } from "./fuel-catalog.ts";
import type { MajorClimb, PredictedStep, RouteSportGroup } from "./route-prediction.ts";

/** Default carbs per hour by sport group (ADR 0017); the athlete can change it per route. */
export const DEFAULT_CARB_TARGET: Record<RouteSportGroup, number> = {
  cycling: 80,
  running: 60,
  walking: 40,
};
export const MAX_CARBS_PER_HOUR = 120;
/** Drink servings rarely land on whole grams: two ¼ bottles of 20.4 g plus two gels is 120.8. */
const ROUNDING_G = 2;

export const DEFAULT_BOTTLES: Record<RouteSportGroup, { count: number; ml: number }> = {
  cycling: { count: 2, ml: 500 },
  running: { count: 1, ml: 500 },
  walking: { count: 1, ml: 500 },
};

/** Carbs taken in the first and last 15 minutes aren't used during the session. */
const WINDOW_EDGE_SEC = 15 * 60;
/** Most fluid an athlete comfortably drinks per hour. */
const FLUID_ML_PER_HOUR: Record<RouteSportGroup, number> = {
  cycling: 750,
  running: 500,
  walking: 500,
};
/** Minutes from intake until the carbs are available (ADR 0017). */
export const LEAD_MIN = {
  drink: 10,
  gelWithFluid: 12,
  gel: 20,
  chew: 20,
  bar: 35,
  caffeinePeak: 45,
} as const;
const READY_MARGIN_SEC = 3 * 60;
const SLOT_SEC = 5 * 60;
const MIN_SOLID_GAP_SEC = 15 * 60;
/** Sips spread the mix over the session, never closer than 15 min or further than 30. */
const SIP_EVERY_SEC: [number, number] = [15 * 60, 30 * 60];
/** Solid food needs a session long enough to digest it. */
const BAR_MIN_ELAPSED_SEC = 2 * 3600;
const CAFFEINE_MG_PER_KG = 3;
/** Above this target, carbs should come from products with a stated glucose:fructose mix. */
const RATIO_RULE_FROM_GPH = 60;
const RATIO_SHARE = 0.8;
const ROLLING_RANGE = [0.8, 1.25] as const;

export type FuelRole = "drink" | "gel" | "bar" | "caffeine";

/** A proposal before the numbers: products per role and the share of carbs each covers. */
export type ProposalSpec = {
  id: string;
  name: string;
  rationale: string;
  drinkId: string | null;
  /** Share of total carbs the drink should cover, before the bottle limit. */
  drinkShare: number;
  /** Gels or chews, used in turn. */
  gelIds: string[];
  barId: string | null;
  barShare: number;
  /** One caffeinated product, timed to peak at the last major climb in the second half. */
  caffeineId: string | null;
};

export type Intake = {
  /** Suggested time from the start; the athlete aims for "around" it. */
  atSec: number;
  earliestSec: number;
  latestSec: number;
  km: number;
  productId: string;
  role: FuelRole;
  /** Servings, or a quarter-bottle fraction for drink sips. */
  amount: number;
  carbsG: number;
  caffeineMg: number;
  readyAtSec: number;
  withFluid: boolean;
  reason: string;
};

export type FuelPlan = {
  spec: ProposalSpec;
  carbTarget: number;
  targetCarbsG: number;
  totalCarbsG: number;
  achievedGph: number;
  caffeineMg: number;
  drink: {
    productId: string;
    /** Bottles with mix; the last one may be partly filled. */
    bottles: number;
    quarters: number;
    carbsPerBottleG: number;
    powderPerBottleG: number | null;
  } | null;
  waterBottles: number;
  bottleMl: number;
  items: { productId: string; role: FuelRole; count: number; carbsG: number }[];
  intakes: Intake[];
  notes: string[];
  /** Rules the plan breaks; empty for a sound plan. */
  issues: string[];
};

export type FuelPlanInput = {
  sportGroup: RouteSportGroup;
  elapsedSec: number;
  steps: Pick<PredictedStep, "atSec" | "distanceM" | "gradePct">[];
  climbs: MajorClimb[];
  carbTarget: number;
  bottles: { count: number; ml: number };
  bodyWeightKg: number;
  products: FuelProduct[];
};

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function carbsOf(product: FuelProduct) {
  return product.carbsG ?? 0;
}

function hasStatedCaffeine(product: FuelProduct) {
  return (product.caffeineMg ?? 0) > 0;
}

/** Which roles a product can fill. */
export function rolesFor(product: FuelProduct): FuelRole[] {
  if (product.kind === "drink") return ["drink"];
  if (product.kind === "bar") return ["bar"];
  if (product.kind === "gel" || product.kind === "chew") {
    return hasStatedCaffeine(product) ? ["caffeine"] : ["gel"];
  }
  return [];
}

function windowFor(elapsedSec: number) {
  return { start: WINDOW_EDGE_SEC, end: Math.max(WINDOW_EDGE_SEC, elapsedSec - WINDOW_EDGE_SEC) };
}

function stepAt(steps: FuelPlanInput["steps"], atSec: number) {
  let low = 0;
  let high = steps.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((steps[mid]?.atSec ?? 0) <= atSec) low = mid;
    else high = mid - 1;
  }
  return steps[low];
}

function kmAt(steps: FuelPlanInput["steps"], atSec: number) {
  return round((stepAt(steps, atSec)?.distanceM ?? 0) / 1000, 1);
}

/** Solids stay off climbs and steep descents on rides; on foot only steep descents are out. */
function terrainAllows(input: FuelPlanInput, role: FuelRole, atSec: number) {
  const grade = stepAt(input.steps, atSec)?.gradePct ?? 0;
  if (input.sportGroup === "cycling") {
    if (role === "bar") return grade < 4 && grade > -4;
    return grade > -6;
  }
  return grade > -6;
}

function climbAt(climbs: MajorClimb[], atSec: number) {
  return climbs.some((climb) => atSec >= climb.startSec && atSec <= climb.endSec);
}

/** Suggested times read "around 1:45": rounded to 5 minutes from the start, not a clock time. */
export function formatAroundTime(sec: number) {
  const minutes = Math.round(sec / 60 / 5) * 5;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Turns a proposal into servings, bottles and a timed intake list. */
export function solveFuelPlan(input: FuelPlanInput, spec: ProposalSpec): FuelPlan {
  const byId = new Map(input.products.map((product) => [product.id, product]));
  const product = (id: string | null) => (id == null ? null : (byId.get(id) ?? null));
  const issues: string[] = [];
  const notes: string[] = [];
  for (const id of [spec.drinkId, spec.barId, spec.caffeineId, ...spec.gelIds]) {
    // The input holds the athlete's own products, so a missing id is one they don't have.
    if (id != null && !byId.has(id)) issues.push(`${id} isn't one of your products.`);
  }

  const window = windowFor(input.elapsedSec);
  const windowHours = (window.end - window.start) / 3600;
  const hours = input.elapsedSec / 3600;
  const carbTarget = clamp(input.carbTarget, 0, MAX_CARBS_PER_HOUR);
  const targetCarbsG = round(carbTarget * hours);
  const bottleMl = input.bottles.ml;
  const bottleCount = Math.max(0, Math.floor(input.bottles.count));

  // Drink: quarter bottles at the store's concentration, within the bottles and the fluid cap.
  const drinkProduct = product(spec.drinkId);
  let drink: FuelPlan["drink"] = null;
  if (drinkProduct?.serving?.mixMl && drinkProduct.carbsG != null && bottleCount > 0) {
    const carbsPerBottleG = (drinkProduct.carbsG / drinkProduct.serving.mixMl) * bottleMl;
    const wanted = clamp(spec.drinkShare, 0, 1) * targetCarbsG;
    const maxQuarters = Math.min(
      bottleCount * 4,
      Math.floor(
        ((FLUID_ML_PER_HOUR[input.sportGroup] * Math.max(windowHours, 0.25)) / bottleMl) * 4,
      ),
    );
    const quarters = Math.min(maxQuarters, Math.round(wanted / (carbsPerBottleG / 4)));
    if (quarters > 0) {
      drink = {
        productId: drinkProduct.id,
        bottles: Math.ceil(quarters / 4),
        quarters,
        carbsPerBottleG: round(carbsPerBottleG, 1),
        powderPerBottleG:
          drinkProduct.serving.grams == null
            ? null
            : round((drinkProduct.serving.grams / drinkProduct.serving.mixMl) * bottleMl),
      };
      const drinkCarbs = (quarters * carbsPerBottleG) / 4;
      if (drinkCarbs < wanted - carbsPerBottleG / 4) {
        notes.push(`Your bottles cover ${round(drinkCarbs)} g of carbs; the rest comes from food.`);
      }
    }
  }
  const drinkCarbs = drink ? (drink.quarters * drink.carbsPerBottleG) / 4 : 0;
  const waterBottles = bottleCount - (drink?.bottles ?? 0);

  // Caffeine: one serving against the last major climb in the second half, under the cap.
  const capMg = CAFFEINE_MG_PER_KG * input.bodyWeightKg;
  const caffeineProduct = product(spec.caffeineId);
  // The climb must start late enough for caffeine taken in the window to peak near it.
  const lateClimb = [...input.climbs]
    .reverse()
    .find(
      (climb) =>
        climb.startSec >= input.elapsedSec / 2 &&
        climb.startSec - LEAD_MIN.caffeinePeak * 60 >= window.start - 10 * 60,
    );
  let caffeineCount = 0;
  if (caffeineProduct && hasStatedCaffeine(caffeineProduct)) {
    if ((caffeineProduct.caffeineMg ?? 0) > capMg) {
      notes.push(
        `${caffeineProduct.name} has more caffeine than ${CAFFEINE_MG_PER_KG} mg per kg of your weight, so it is left out.`,
      );
    } else if (lateClimb) caffeineCount = 1;
  }
  const caffeineCarbs = caffeineCount * (caffeineProduct?.carbsG ?? 0);

  // Bars: rides long enough to digest them, in the first half.
  const barProduct = product(spec.barId);
  const barCount =
    barProduct && input.sportGroup === "cycling" && input.elapsedSec >= BAR_MIN_ELAPSED_SEC
      ? Math.max(0, Math.round((clamp(spec.barShare, 0, 1) * targetCarbsG) / carbsOf(barProduct)))
      : 0;
  const barCarbs = barCount * (barProduct?.carbsG ?? 0);

  // Gels fill the rest, rounding down unless most of a gel is still missing.
  const gels = spec.gelIds.flatMap((id) => {
    const found = product(id);
    return found && found.carbsG != null ? [found] : [];
  });
  const gelCarbs = gels.length
    ? gels.reduce((sum, item) => sum + carbsOf(item), 0) / gels.length
    : 0;
  const remaining = targetCarbsG - drinkCarbs - caffeineCarbs - barCarbs;
  const gelCount = gelCarbs > 0 ? Math.max(0, Math.floor(remaining / gelCarbs + 0.25)) : 0;
  if (remaining > gelCarbs / 2 && gels.length === 0) {
    issues.push("Nothing covers the carbs the bottles can't.");
  }

  const schedule: Schedule = {
    window,
    drink,
    drinkProduct,
    waterBottles,
    caffeine:
      caffeineCount && caffeineProduct && lateClimb
        ? { product: caffeineProduct, climb: lateClimb }
        : null,
    bar: barProduct ? { product: barProduct, count: barCount } : null,
    gels: Array.from({ length: gelCount }, (_, index) => gels[index % gels.length] as FuelProduct),
    gelProducts: gels,
    windowRate: windowHours > 0 ? targetCarbsG / windowHours : 0,
  };
  const plannedCarbs = drinkCarbs + caffeineCarbs + barCarbs + gelCount * gelCarbs;

  const assemble = (intakes: Intake[]): FuelPlan => {
    const totalCarbsG = round(intakes.reduce((sum, intake) => sum + intake.carbsG, 0));
    const planNotes = [...notes];
    if (plannedCarbs - totalCarbsG >= gelCarbs / 2 && gelCarbs > 0) {
      planNotes.push(
        `${round(plannedCarbs - totalCarbsG)} g didn't fit without packing too much into one hour.`,
      );
    }
    const counts = new Map<string, FuelPlan["items"][number]>();
    for (const intake of intakes) {
      if (intake.role === "drink") continue;
      const item = counts.get(intake.productId) ?? {
        productId: intake.productId,
        role: intake.role,
        count: 0,
        carbsG: 0,
      };
      item.count += intake.amount;
      item.carbsG += intake.carbsG;
      counts.set(intake.productId, item);
    }
    const plan: FuelPlan = {
      spec,
      carbTarget,
      targetCarbsG,
      totalCarbsG,
      achievedGph: hours > 0 ? round(totalCarbsG / hours) : 0,
      caffeineMg: intakes.reduce((sum, intake) => sum + intake.caffeineMg, 0),
      drink,
      waterBottles,
      bottleMl,
      items: [...counts.values()],
      intakes,
      notes: planNotes,
      issues: [...issues],
    };
    plan.issues.push(...checkPlan(input, plan));
    return plan;
  };

  // Two ways to lay the servings out; keep the one that breaks fewer rules, then lands closer.
  const [even, closest] = (["even", "closest"] as const).map((strategy) =>
    assemble(scheduleIntakes(input, schedule, strategy)),
  ) as [FuelPlan, FuelPlan];
  const score = (plan: FuelPlan) =>
    plan.issues.length * 1000 + Math.abs(plan.targetCarbsG - plan.totalCarbsG);
  return score(even) <= score(closest) ? even : closest;
}

type Schedule = {
  window: { start: number; end: number };
  drink: FuelPlan["drink"];
  drinkProduct: FuelProduct | null;
  waterBottles: number;
  caffeine: { product: FuelProduct; climb: MajorClimb } | null;
  bar: { product: FuelProduct; count: number } | null;
  gels: FuelProduct[];
  /** The proposal's gels, for carbs a bar or caffeine can't carry. */
  gelProducts: FuelProduct[];
  /** Grams per hour inside the intake window that add up to the session's target. */
  windowRate: number;
};

function scheduleIntakes(
  input: FuelPlanInput,
  plan: Schedule,
  strategy: "even" | "closest",
): Intake[] {
  const { window } = plan;
  const intakes: Intake[] = [];
  const steps = input.steps;

  // Sips: a quarter bottle at a time, spread over the window until the mix runs out.
  const sipTimes: number[] = [];
  if (plan.drink && plan.drinkProduct) {
    const [fastest, slowest] = SIP_EVERY_SEC;
    const every = clamp((window.end - window.start) / plan.drink.quarters, fastest, slowest);
    for (let index = 0; index < plan.drink.quarters; index += 1) {
      const atSec = Math.min(window.end, window.start + index * every);
      sipTimes.push(atSec);
      const bottle = Math.floor(index / 4) + 1;
      intakes.push({
        atSec: round(atSec),
        earliestSec: round(Math.max(window.start, atSec - SLOT_SEC)),
        latestSec: round(Math.min(window.end, atSec + SLOT_SEC)),
        km: kmAt(steps, atSec),
        productId: plan.drinkProduct.id,
        role: "drink",
        amount: 0.25,
        carbsG: round(plan.drink.carbsPerBottleG / 4, 1),
        caffeineMg: 0,
        readyAtSec: round(atSec + LEAD_MIN.drink * 60),
        withFluid: true,
        reason: `¼ of bottle ${bottle}`,
      });
    }
  }
  const lastSip = sipTimes.at(-1) ?? -Infinity;
  const withFluidAt = (atSec: number) => plan.waterBottles > 0 || atSec <= lastSip + SLOT_SEC;
  const solidLead = (product: FuelProduct, atSec: number) =>
    product.kind === "bar"
      ? LEAD_MIN.bar
      : product.kind === "chew"
        ? LEAD_MIN.chew
        : withFluidAt(atSec)
          ? LEAD_MIN.gelWithFluid
          : LEAD_MIN.gel;
  const solids: Intake[] = [];
  const addSolid = (
    product: FuelProduct,
    role: FuelRole,
    atSec: number,
    bounds: [number, number],
    reason: string,
  ) => {
    const at = clamp(atSec, window.start, window.end);
    const lead = role === "caffeine" ? LEAD_MIN.caffeinePeak : solidLead(product, at);
    const intake: Intake = {
      atSec: round(at),
      earliestSec: round(clamp(bounds[0], window.start, at)),
      latestSec: round(clamp(bounds[1], at, window.end)),
      km: kmAt(steps, at),
      productId: product.id,
      role,
      amount: 1,
      carbsG: carbsOf(product),
      caffeineMg: product.caffeineMg ?? 0,
      readyAtSec: round(at + lead * 60),
      withFluid: product.kind !== "bar" && withFluidAt(at),
      reason,
    };
    solids.push(intake);
    return intake;
  };
  const tooClose = (atSec: number) =>
    solids.some((intake) => Math.abs(intake.atSec - atSec) < MIN_SOLID_GAP_SEC);
  /** No hour, on the same grid the plan check uses, goes over the target's ceiling. */
  const ceiling = Math.min(MAX_CARBS_PER_HOUR, plan.windowRate * ROLLING_RANGE[1]);
  const fitsHour = (atSec: number, carbs: number) => {
    const all = [...intakes, ...solids, { atSec, carbsG: carbs }];
    const limit = Math.min(MAX_CARBS_PER_HOUR, ceiling + Math.max(...all.map((i) => i.carbsG)));
    const first = window.start + Math.ceil((atSec - 3600 - window.start + 1) / SLOT_SEC) * SLOT_SEC;
    for (let start = first; start <= atSec; start += SLOT_SEC) {
      const total = all
        .filter((intake) => intake.atSec >= start && intake.atSec < start + 3600)
        .reduce((sum, intake) => sum + intake.carbsG, 0);
      if (total > limit + ROUNDING_G) return false;
    }
    return true;
  };
  /** Nearest of the given shifts (minutes) that suits the terrain, the hour, and spacing. */
  const settle = (role: FuelRole, atSec: number, carbs: number, shifts = [0, -5, 5, -10, 10]) => {
    for (const shift of shifts) {
      const candidate = atSec + shift * 60;
      if (candidate < window.start || candidate > window.end) continue;
      if (!terrainAllows(input, role, candidate) || tooClose(candidate)) continue;
      if (!fitsHour(candidate, carbs)) continue;
      if (role === "bar" && climbAt(input.climbs, candidate)) continue;
      return candidate;
    }
    return null;
  };

  // 1. One gel ready at the start of each major climb: fuelling ahead of the hard part comes first.
  const gels = [...plan.gels];
  for (const climb of input.climbs) {
    const gel = gels[0];
    if (!gel) break;
    const lead = solidLead(gel, climb.startSec) * 60;
    const latest = climb.startSec - lead;
    // Earlier is fine: the gel is still ready by the climb.
    const target = settle("gel", latest - READY_MARGIN_SEC, carbsOf(gel), [0, -5, -10]);
    if (target == null) continue;
    gels.shift();
    addSolid(
      gel,
      "gel",
      target,
      [Math.min(target, latest - 10 * 60), latest],
      `ready for the climb at km ${climb.startKm}, around ${formatAroundTime(climb.startSec)}`,
    );
  }

  // 2. Caffeine peaks as the last major climb starts, give or take 20 minutes.
  if (plan.caffeine) {
    const { climb, product } = plan.caffeine;
    const target = climb.startSec - LEAD_MIN.caffeinePeak * 60;
    const at = settle("caffeine", target, carbsOf(product), [0, -5, 5, -10, 10, -15, -20]);
    if (at != null) {
      addSolid(
        product,
        "caffeine",
        at,
        [at - 10 * 60, at + 10 * 60],
        `caffeine peaks for the climb at km ${climb.startKm}, around ${formatAroundTime(climb.startSec)}`,
      );
    } else if (plan.gelProducts[0]) {
      // No room before the climb: a plain gel keeps the carbs.
      gels.push(plan.gelProducts[0]);
    }
  }

  // 3. Bars, then gels, each go where every hour comes closest to the rate the target needs,
  // counting the sips and fixed intakes around them. Bars only go in the first half, while
  // there's time to digest them; any that don't fit become gels.
  const half = window.start + (window.end - window.start) / 2;
  const rate = plan.windowRate / 3600;
  // Hours on the same grid the plan check uses; a window under an hour is judged whole.
  const span = Math.min(3600, window.end - window.start);
  const hours: { start: number; total: number }[] = [];
  for (let start = window.start; start + span <= window.end; start += SLOT_SEC) {
    const total = [...intakes, ...solids]
      .filter((intake) => intake.atSec >= start && intake.atSec < start + span)
      .reduce((sum, intake) => sum + intake.carbsG, 0);
    hours.push({ start, total });
  }
  const perHour = rate * span;
  const costWith = (atSec: number, carbs: number) =>
    hours.reduce((sum, hour) => {
      const inside = atSec >= hour.start && atSec < hour.start + span;
      return sum + (hour.total + (inside ? carbs : 0) - perHour) ** 2;
    }, 0);
  const slots: number[] = [];
  for (let t = window.start; t <= window.end; t += SLOT_SEC) slots.push(t);
  const allowed = (role: FuelRole, t: number, carbs: number) =>
    !tooClose(t) &&
    fitsHour(t, carbs) &&
    terrainAllows(input, role, t) &&
    (role !== "bar" || (t <= half && !climbAt(input.climbs, t)));
  const reasonAt = (role: FuelRole, t: number) =>
    role === "bar"
      ? "solid food early, on flat ground"
      : climbAt(input.climbs, t)
        ? "keeps carbs coming on the climb"
        : "keeps carbs steady";

  const queue: { product: FuelProduct; role: FuelRole }[] = [
    ...Array.from({ length: plan.bar?.count ?? 0 }, () => ({
      product: plan.bar?.product as FuelProduct,
      role: "bar" as const,
    })),
    ...gels.map((product) => ({ product, role: "gel" as const })),
  ];
  // "even" first tries a regular grid per role (bars over the first half, gels over the whole
  // window); "closest" goes straight to the best-scoring slot.
  const evenSlot = (role: FuelRole, index: number) => {
    const count = queue.filter((item) => item.role === role).length + index + 1;
    const end = role === "bar" ? half : window.end;
    const at = window.start + ((end - window.start) * (index + 0.5)) / count;
    return Math.round(at / SLOT_SEC) * SLOT_SEC;
  };
  const placedByRole: Partial<Record<FuelRole, number>> = {};
  while (queue.length > 0) {
    const next = queue.shift() as (typeof queue)[number];
    const carbs = carbsOf(next.product);
    let best: number | null = null;
    let bestCost = Infinity;
    if (strategy === "even") {
      const index = placedByRole[next.role] ?? 0;
      const target = evenSlot(next.role, index);
      best =
        [0, -5, 5].map((shift) => target + shift * 60).find((t) => allowed(next.role, t, carbs)) ??
        null;
      if (best != null) bestCost = -Infinity;
    }
    for (const t of best == null ? slots : []) {
      if (!allowed(next.role, t, carbs)) continue;
      const cost = costWith(t, carbs);
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    if (best == null) {
      const gel = plan.gelProducts[0];
      if (next.role === "bar" && gel) {
        const extra = Math.round(carbs / carbsOf(gel));
        queue.push(
          ...Array.from({ length: extra }, () => ({ product: gel, role: "gel" as const })),
        );
      }
      continue;
    }
    const at = best;
    placedByRole[next.role] = (placedByRole[next.role] ?? 0) + 1;
    for (const hour of hours) {
      if (at >= hour.start && at < hour.start + span) hour.total += carbs;
    }
    addSolid(
      next.product,
      next.role,
      at,
      next.role === "bar" ? [at - 10 * 60, at + 10 * 60] : [at - SLOT_SEC, at + SLOT_SEC],
      reasonAt(next.role, at),
    );
  }

  return [...intakes, ...solids].sort((a, b) => a.atSec - b.atSec || a.role.localeCompare(b.role));
}

/** Rules every plan is held to; each failure is a sentence the athlete can read. */
export function checkPlan(input: FuelPlanInput, plan: FuelPlan): string[] {
  const issues: string[] = [];
  const byId = new Map(input.products.map((product) => [product.id, product]));
  const window = windowFor(input.elapsedSec);

  if (plan.carbTarget > RATIO_RULE_FROM_GPH && plan.totalCarbsG > 0) {
    const mixed = plan.intakes
      .filter((intake) => byId.get(intake.productId)?.glucoseFructose != null)
      .reduce((sum, intake) => sum + intake.carbsG, 0);
    if (mixed / plan.totalCarbsG < RATIO_SHARE) {
      issues.push(
        `Above ${RATIO_RULE_FROM_GPH} g/h most carbs should come from products with a stated glucose:fructose mix.`,
      );
    }
  }

  // Rolling hour: only hours wholly inside the intake window are judged, against the rate that
  // window needs to reach the target. Servings come in whole units, so an hour may be one off.
  const slack = Math.max(0, ...plan.intakes.map((intake) => intake.carbsG));
  const windowHours = (window.end - window.start) / 3600;
  const rate = windowHours > 0 ? plan.targetCarbsG / windowHours : 0;
  if (window.end - window.start >= 3600 && rate > 0) {
    for (let start = window.start; start + 3600 <= window.end; start += SLOT_SEC) {
      const carbs = plan.intakes
        .filter((intake) => intake.atSec >= start && intake.atSec < start + 3600)
        .reduce((sum, intake) => sum + intake.carbsG, 0);
      if (carbs > MAX_CARBS_PER_HOUR + ROUNDING_G) {
        issues.push(
          `More than ${MAX_CARBS_PER_HOUR} g of carbs in the hour from ${formatAroundTime(start)}.`,
        );
        break;
      }
      if (
        carbs < rate * ROLLING_RANGE[0] - slack - ROUNDING_G ||
        carbs > rate * ROLLING_RANGE[1] + slack + ROUNDING_G
      ) {
        issues.push(
          `The hour from ${formatAroundTime(start)} gets ${round(carbs)} g, off your ${plan.carbTarget} g/h.`,
        );
        break;
      }
    }
  }

  const drinkMl = plan.drink ? (plan.drink.quarters / 4) * plan.bottleMl : 0;
  if (drinkMl > input.bottles.count * input.bottles.ml) {
    issues.push("The plan needs more drink than your bottles hold.");
  }
  const capMg = CAFFEINE_MG_PER_KG * input.bodyWeightKg;
  if (plan.caffeineMg > capMg) {
    issues.push(
      `${plan.caffeineMg} mg of caffeine is over ${round(capMg)} mg (${CAFFEINE_MG_PER_KG} mg/kg).`,
    );
  }
  for (const intake of plan.intakes) {
    const product = byId.get(intake.productId);
    if (!product || product.carbsG == null) {
      issues.push(`${intake.productId} has no stated carbs.`);
      break;
    }
  }
  return issues;
}

function pick<T>(items: T[], preferred: (item: T) => boolean) {
  return items.find(preferred) ?? items[0] ?? null;
}

/**
 * Three distinct starting proposals the coach model may refine: drink-led, gel-led, and solids
 * early on rides (chews on foot). Above 90 g/h they prefer 1:0.8 products, else 2:1.
 */
export function defaultProposals(input: FuelPlanInput): ProposalSpec[] {
  const ratio = input.carbTarget >= 90 ? "1:0.8" : "2:1";
  const sorted = [...input.products].sort((a, b) => a.id.localeCompare(b.id));
  const byRole = (role: FuelRole) => sorted.filter((product) => rolesFor(product).includes(role));
  const preferRatio = (product: FuelProduct) => product.glucoseFructose === ratio;

  const drinks = byRole("drink");
  // A stronger mix when the target is high, so the bottles carry more of it.
  const drinkPick =
    pick(
      drinks,
      (product) => preferRatio(product) && carbsOf(product) >= (input.carbTarget >= 70 ? 75 : 0),
    ) ?? null;
  const gels = byRole("gel");
  const plainGels = gels.filter((product) => product.kind === "gel");
  const chews = gels.filter((product) => product.kind === "chew");
  const gelA = pick(plainGels, preferRatio);
  const gelB = pick(
    plainGels.filter((product) => product.id !== gelA?.id),
    preferRatio,
  );
  const chew = pick(chews, preferRatio);
  const bar = pick(byRole("bar"), preferRatio);
  const caffeine = pick(
    byRole("caffeine"),
    (product) =>
      preferRatio(product) && (product.caffeineMg ?? 0) <= CAFFEINE_MG_PER_KG * input.bodyWeightKg,
  );
  const ids = (...products: (FuelProduct | null)[]) =>
    products.flatMap((product) => (product ? [product.id] : []));

  const proposals: ProposalSpec[] = [
    {
      id: "drink-led",
      name: "Drink-led",
      rationale: "Most carbs come from your bottles; gels top up before the climbs.",
      drinkId: drinkPick?.id ?? null,
      drinkShare: 0.6,
      gelIds: ids(gelA),
      barId: null,
      barShare: 0,
      caffeineId: caffeine?.id ?? null,
    },
    {
      id: "gel-led",
      name: "Gel-led",
      rationale: "Water in the bottles and gels on a steady clock: simple to carry and to count.",
      drinkId: null,
      drinkShare: 0,
      gelIds: ids(gelB ?? gelA, chew),
      barId: null,
      barShare: 0,
      caffeineId: null,
    },
  ];
  if (input.sportGroup === "cycling" && input.elapsedSec >= BAR_MIN_ELAPSED_SEC && bar) {
    proposals.push({
      id: "solids-early",
      name: "Solids early",
      rationale: "A bar or two while the stomach is fresh, then drink and gels when it gets hard.",
      drinkId: drinkPick?.id ?? null,
      drinkShare: 0.4,
      gelIds: ids(gelB ?? gelA),
      barId: bar.id,
      barShare: 0.15,
      caffeineId: caffeine?.id ?? null,
    });
  } else if (chew) {
    proposals.push({
      id: "chews",
      name: "Chews and sips",
      rationale: "Chews are easier to take in small bites while moving, with some drink mix.",
      drinkId: drinkPick?.id ?? null,
      drinkShare: 0.3,
      gelIds: ids(chew),
      barId: null,
      barShare: 0,
      caffeineId: caffeine?.id ?? null,
    });
  }
  // With few products the templates can collapse into the same mix; keep each mix once.
  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    const mix = [proposal.drinkId, proposal.barId, proposal.caffeineId, ...proposal.gelIds].join();
    if (seen.has(mix)) return false;
    seen.add(mix);
    return true;
  });
}

/**
 * Products that can take another product's place: same role, stated carbs. Pass `current` when
 * the product being replaced is no longer among `products`.
 */
export function swapOptions(
  products: FuelProduct[],
  productId: string,
  current = products.find((product) => product.id === productId),
): FuelProduct[] {
  if (!current) return [];
  const roles = rolesFor(current);
  return products.filter(
    (product) =>
      product.id !== productId &&
      product.carbsG != null &&
      rolesFor(product).some((role) => roles.includes(role)),
  );
}

/** Replaces a product in its role and re-solves, so the plan keeps the target. */
export function swapProduct(
  input: FuelPlanInput,
  spec: ProposalSpec,
  productId: string,
  replacementId: string,
  current?: FuelProduct,
): FuelPlan {
  const options = swapOptions(input.products, productId, current);
  if (!options.some((product) => product.id === replacementId)) {
    throw new Error(`${replacementId} can't replace ${productId}.`);
  }
  const swap = (id: string | null) => (id === productId ? replacementId : id);
  return solveFuelPlan(input, {
    ...spec,
    drinkId: swap(spec.drinkId),
    barId: swap(spec.barId),
    caffeineId: swap(spec.caffeineId),
    gelIds: spec.gelIds.map((id) => swap(id) as string),
  });
}
