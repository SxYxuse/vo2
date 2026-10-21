import type { FuelProduct } from "./fuel-catalog.ts";
import type { PredictedStep, RouteClimb, RouteSportGroup } from "./route-prediction.ts";

/** Default carbs per hour by sport group (ADR 0017); the athlete can change it per route. */
export const DEFAULT_CARB_TARGET: Record<RouteSportGroup, number> = {
  cycling: 80,
  running: 60,
  walking: 40,
};
export const MAX_CARBS_PER_HOUR = 120;
/** Drink sips rarely land on whole grams: two sips of 20.4 g plus two gels is 120.8. */
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
/** The athlete takes a sip every 15-20 minutes; the plan counts one every 20. */
export const SIP_EVERY_MIN = [15, 20] as const;
const SIP_SEC = SIP_EVERY_MIN[1] * 60;
/** Strongest mix the plan makes: POWER CARB's own strength, about 160 g of carbs per litre. */
const MAX_DRINK_G_PER_ML = 0.165;
/** Below this the athlete runs short of fluid, so the plan asks for a refill. */
const MIN_FLUID_ML_PER_HOUR = 400;
const REFILL_ML_PER_HOUR = 500;
/** Solid food needs a session long enough to digest it. */
const BAR_MIN_ELAPSED_SEC = 2 * 3600;
const CAFFEINE_MG_PER_KG = 3;
/** Above this target, carbs should come from products with a stated glucose:fructose mix. */
const RATIO_RULE_FROM_GPH = 60;
const RATIO_SHARE = 0.8;
const ROLLING_RANGE = [0.8, 1.25] as const;

export type FuelRole = "drink" | "gel" | "bar" | "jelly" | "caffeine";

/** A proposal before the numbers: products per role and the share of carbs each covers. */
export type ProposalSpec = {
  id: string;
  name: string;
  rationale: string;
  drinkId: string | null;
  /** Share of total carbs the drink should cover, before the bottle limit. */
  drinkShare: number;
  /** Gels used in turn. */
  gelIds: string[];
  /** One solid: a jelly, a bar, or chews. */
  solidId: string | null;
  solidShare: number;
  /** One caffeinated product, timed to peak at the last climb in the second half. */
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
  /** Servings, or the share of the mix for a drink sip. */
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
    /** Bottles with mix, each mixed to carbsPerBottleG and sipped through the session. */
    bottles: number;
    carbsPerBottleG: number;
    powderPerBottleG: number | null;
  } | null;
  waterBottles: number;
  bottleMl: number;
  /** The bottles' fluid per hour, and where to refill when that is too little. */
  fluid: { mlPerHour: number; refill: { atSec: number; km: number } | null };
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
  climbs: RouteClimb[];
  carbTarget: number;
  /** `mix`: bottles the athlete fills with drink mix; null or absent lets the plan decide. */
  bottles: { count: number; ml: number; mix?: number | null };
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
  if (product.kind === "jelly" || product.kind === "chew") {
    return hasStatedCaffeine(product) ? ["caffeine"] : ["jelly"];
  }
  if (product.kind === "gel") {
    return hasStatedCaffeine(product) ? ["caffeine"] : ["gel"];
  }
  return [];
}

function solidRole(product: FuelProduct): Extract<FuelRole, "bar" | "jelly"> | null {
  return (
    rolesFor(product).find((role): role is "bar" | "jelly" => role === "bar" || role === "jelly") ??
    null
  );
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

function solidReason(role: "bar" | "jelly") {
  return role === "bar" ? "solid food early, on flat ground" : "solid food while the road is easy";
}

function climbAt(climbs: RouteClimb[], atSec: number) {
  return climbs.some((climb) => atSec >= climb.startSec && atSec <= climb.endSec);
}

/**
 * On rides, bars and jelly stay off climbs (chewing at threshold is hard) and steep descents;
 * gels only stay off steep descents. On foot only steep descents are out.
 */
export function terrainAllows(input: FuelPlanInput, role: FuelRole, atSec: number) {
  const grade = stepAt(input.steps, atSec)?.gradePct ?? 0;
  if (input.sportGroup === "cycling" && (role === "bar" || role === "jelly")) {
    if (climbAt(input.climbs, atSec)) return false;
    return role === "bar" ? grade < 4 && grade > -4 : grade < 4 && grade > -6;
  }
  return grade > -6;
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
  for (const id of [spec.drinkId, spec.solidId, spec.caffeineId, ...spec.gelIds]) {
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

  // Drink: the bottles the athlete fills with mix, or as many as the share needs at the store's
  // strength; mixed stronger (up to POWER CARB's strength) when they are too few. The athlete
  // sips it all session.
  const drinkProduct = product(spec.drinkId);
  let drink: FuelPlan["drink"] = null;
  if (drinkProduct?.serving?.mixMl && drinkProduct.carbsG != null && bottleCount > 0) {
    const storeStrength = drinkProduct.carbsG / drinkProduct.serving.mixMl;
    const maxPerBottle = Math.max(storeStrength, MAX_DRINK_G_PER_ML) * bottleMl;
    const wanted = clamp(spec.drinkShare, 0, 1) * targetCarbsG;
    // No more mix than the athlete can drink in the session.
    const drinkable = Math.max(
      1,
      Math.floor((FLUID_ML_PER_HOUR[input.sportGroup] * Math.max(hours, 0.25)) / bottleMl),
    );
    const bottles =
      input.bottles.mix != null
        ? clamp(Math.floor(input.bottles.mix), 1, bottleCount)
        : clamp(
            Math.ceil(wanted / (storeStrength * bottleMl)),
            1,
            Math.min(bottleCount, drinkable),
          );
    const carbsPerBottleG = round(Math.min(maxPerBottle, wanted / bottles), 1);
    if (wanted > 0 && carbsPerBottleG > 0) {
      drink = {
        productId: drinkProduct.id,
        bottles,
        carbsPerBottleG,
        powderPerBottleG:
          drinkProduct.serving.grams == null
            ? null
            : round((drinkProduct.serving.grams / drinkProduct.carbsG) * carbsPerBottleG),
      };
      if (bottles * carbsPerBottleG < wanted - carbsPerBottleG / 4) {
        notes.push(
          `Your bottles cover ${round(bottles * carbsPerBottleG)} g of carbs; the rest comes from food.`,
        );
      }
    }
  }
  const drinkCarbs = drink ? drink.bottles * drink.carbsPerBottleG : 0;
  const waterBottles = bottleCount - (drink?.bottles ?? 0);

  // Fluid: the bottles carried, sipped evenly; too little per hour needs a refill on the way.
  const fluidMl = bottleCount * bottleMl;
  const mlPerHour = hours > 0 ? round(fluidMl / hours / 10) * 10 : 0;
  const refillSec = Math.min(input.elapsedSec, (fluidMl / REFILL_ML_PER_HOUR) * 3600);
  const fluid: FuelPlan["fluid"] = {
    mlPerHour,
    refill:
      hours > 1 && mlPerHour < MIN_FLUID_ML_PER_HOUR
        ? { atSec: round(refillSec), km: kmAt(input.steps, refillSec) }
        : null,
  };

  // Caffeine: one serving against the last climb in the second half, under the cap.
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

  // One solid: bars only on long rides; jelly and chews go on any session.
  const solidProduct = product(spec.solidId);
  const solidKind = solidProduct ? solidRole(solidProduct) : null;
  const solidAllowed =
    solidProduct != null &&
    solidKind != null &&
    (solidKind !== "bar" ||
      (input.sportGroup === "cycling" && input.elapsedSec >= BAR_MIN_ELAPSED_SEC));
  const solidCount =
    solidAllowed && solidProduct
      ? Math.max(
          0,
          Math.round((clamp(spec.solidShare, 0, 1) * targetCarbsG) / carbsOf(solidProduct)),
        )
      : 0;
  const solidCarbs = solidCount * (solidProduct?.carbsG ?? 0);

  // Gels fill the rest, rounding down unless most of a gel is still missing.
  const gels = spec.gelIds.flatMap((id) => {
    const found = product(id);
    return found && found.carbsG != null ? [found] : [];
  });
  const gelCarbs = gels.length
    ? gels.reduce((sum, item) => sum + carbsOf(item), 0) / gels.length
    : 0;
  const remaining = targetCarbsG - drinkCarbs - caffeineCarbs - solidCarbs;
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
    solid:
      solidProduct && solidKind && solidCount > 0
        ? { product: solidProduct, role: solidKind, count: solidCount }
        : null,
    gels: Array.from({ length: gelCount }, (_, index) => gels[index % gels.length] as FuelProduct),
    gelProducts: gels,
    windowRate: windowHours > 0 ? targetCarbsG / windowHours : 0,
  };
  const plannedCarbs = drinkCarbs + caffeineCarbs + solidCarbs + gelCount * gelCarbs;

  const assemble = ({ intakes, notes: scheduleNotes }: ReturnType<typeof scheduleIntakes>) => {
    const totalCarbsG = round(intakes.reduce((sum, intake) => sum + intake.carbsG, 0));
    const planNotes = [...notes, ...scheduleNotes];
    if (plannedCarbs - totalCarbsG >= gelCarbs / 2 && gelCarbs > 0) {
      planNotes.push(
        `${round(plannedCarbs - totalCarbsG)} g didn't fit without going over ${MAX_CARBS_PER_HOUR} g in an hour.`,
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
      fluid,
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
  caffeine: { product: FuelProduct; climb: RouteClimb } | null;
  solid: { product: FuelProduct; role: Extract<FuelRole, "bar" | "jelly">; count: number } | null;
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
): { intakes: Intake[]; notes: string[] } {
  const { window } = plan;
  const intakes: Intake[] = [];
  const skipped: string[] = [];
  const steps = input.steps;

  // Sips: a little every 15-20 minutes over the whole window. The athlete isn't told each one;
  // they are listed so every hour's carbs add up.
  if (plan.drink && plan.drinkProduct) {
    const count = Math.floor((window.end - window.start) / SIP_SEC) + 1;
    const carbs = (plan.drink.bottles * plan.drink.carbsPerBottleG) / count;
    for (let index = 0; index < count; index += 1) {
      const atSec = window.start + index * SIP_SEC;
      intakes.push({
        atSec: round(atSec),
        earliestSec: round(Math.max(window.start, atSec - SLOT_SEC)),
        latestSec: round(Math.min(window.end, atSec + SLOT_SEC)),
        km: kmAt(steps, atSec),
        productId: plan.drinkProduct.id,
        role: "drink",
        amount: round(1 / count, 3),
        carbsG: round(carbs, 1),
        caffeineMg: 0,
        readyAtSec: round(atSec + LEAD_MIN.drink * 60),
        withFluid: true,
        reason: "a sip",
      });
    }
  }
  const hasFluid = plan.drink != null || plan.waterBottles > 0;
  const withFluidAt = (_atSec: number) => hasFluid;
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
      return candidate;
    }
    return null;
  };

  // 1. Caffeine first, so the gels for earlier climbs can't take its hour: it peaks as the last
  // climb starts, give or take 20 minutes, and fuels that climb.
  const gels = [...plan.gels];
  let caffeineClimb: RouteClimb | null = null;
  if (plan.caffeine) {
    const { climb, product } = plan.caffeine;
    const target = climb.startSec - LEAD_MIN.caffeinePeak * 60;
    const at = settle("caffeine", target, carbsOf(product), [0, -5, 5, -10, 10, -15, -20]);
    if (at != null) {
      caffeineClimb = climb;
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
      skipped.push(
        `${product.name} didn't fit before the last climb, so a plain gel takes its place.`,
      );
    }
  }

  // 2. One gel ready at the start of each other climb, hardest first, so small rollers don't
  // steal them.
  for (const climb of [...input.climbs].sort(
    (a, b) => b.gainM - a.gainM || a.startSec - b.startSec,
  )) {
    if (climb === caffeineClimb) continue;
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

  // 3. Solids, then leftover gels, each go where every hour comes closest to the rate the
  // target needs. Bars only go in the first half, on the flat; jelly and chews can go later.
  // Solids that don't fit become gels.
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
    (role !== "bar" || t <= half);
  const reasonAt = (role: FuelRole, t: number) =>
    role === "bar" || role === "jelly"
      ? solidReason(role)
      : climbAt(input.climbs, t)
        ? "keeps carbs coming on the climb"
        : "keeps carbs steady";

  const queue: { product: FuelProduct; role: FuelRole; retried?: boolean }[] = [
    ...Array.from({ length: plan.solid?.count ?? 0 }, () => ({
      product: plan.solid?.product as FuelProduct,
      role: (plan.solid?.role ?? "jelly") as FuelRole,
    })),
    ...gels.map((product) => ({ product, role: "gel" as const })),
  ];
  // "even" first tries a regular grid per role (bars over the first half, solids and gels over
  // the whole window); "closest" goes straight to the best-scoring slot.
  const evenSlot = (role: FuelRole, index: number) => {
    const count = queue.filter((item) => item.role === role).length + index + 1;
    const end = role === "bar" ? half : window.end;
    const at = window.start + ((end - window.start) * (index + 0.5)) / count;
    return Math.round(at / SLOT_SEC) * SLOT_SEC;
  };
  const placedByRole: Partial<Record<FuelRole, number>> = {};
  let converted = 0;
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
    const isSolid = next.role === "bar" || next.role === "jelly";
    if (best == null && isSolid && !next.retried) {
      // Try again once the gels are down: they may leave a better gap.
      queue.push({ ...next, retried: true });
      continue;
    }
    if (best == null && isSolid && !placedByRole[next.role]) {
      // Every plan keeps its one solid. With the hours full it takes a gel's place where the
      // terrain suits it: one that only keeps carbs steady first, else one before a climb (the
      // carbs still arrive, just as food).
      const latestSolid = window.start + (window.end - window.start) * 0.75;
      // Earliest first: solid food digests best early.
      const swappable = solids
        .filter(
          (intake) =>
            intake.role === "gel" &&
            terrainAllows(input, next.role, intake.atSec) &&
            (next.role !== "bar" || intake.atSec <= latestSolid) &&
            Math.abs(intake.carbsG - carbs) <= 10,
        )
        .sort((a, b) => a.atSec - b.atSec);
      const swap =
        swappable.find((intake) => intake.reason === reasonAt("gel", intake.atSec)) ?? swappable[0];
      if (swap) {
        solids.splice(solids.indexOf(swap), 1);
        for (const hour of hours) {
          if (swap.atSec >= hour.start && swap.atSec < hour.start + span) {
            hour.total -= swap.carbsG;
          }
        }
        best = swap.atSec;
      }
    }
    if (best == null) {
      // A solid that doesn't fit becomes gels, still rotating through the plan's flavours.
      const gel = plan.gelProducts[converted % Math.max(1, plan.gelProducts.length)];
      if (isSolid && gel) {
        converted += 1;
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
      isSolid ? [at - 10 * 60, at + 10 * 60] : [at - SLOT_SEC, at + SLOT_SEC],
      reasonAt(next.role, at),
    );
  }

  return {
    intakes: [...intakes, ...solids].sort(
      (a, b) => a.atSec - b.atSec || a.role.localeCompare(b.role),
    ),
    notes: skipped,
  };
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

  const drinkMl = plan.drink ? plan.drink.bottles * plan.bottleMl : 0;
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

const DRINK_LINE_ORDER = ["SLOW CARB", "FAST CARB", "POWER CARB"];

function slugLine(line: string) {
  return line.toLowerCase().replaceAll(" ", "-");
}

/** Up to three plain gels, the given ones first, so a long session rotates flavours. */
export function withGelVariety(spec: ProposalSpec, products: FuelProduct[]): ProposalSpec {
  const others = products
    .filter((product) => rolesFor(product).includes("gel") && product.carbsG != null)
    .map((product) => product.id)
    .sort()
    .filter((id) => !spec.gelIds.includes(id));
  return { ...spec, gelIds: [...spec.gelIds, ...others].slice(0, Math.max(3, spec.gelIds.length)) };
}

/** How each starting proposal splits the carbs, so the three differ by more than a flavour. */
const STYLES = [
  { label: null, drink: 0, solid: 0 },
  { label: "more from the bottles", drink: 0.2, solid: -0.1 },
  { label: "more solid food", drink: -0.1, solid: 0.15 },
] as const;

/**
 * Up to three starting proposals the coach model may refine. Each has a drink mix, one solid
 * (jelly, bar, or chews), and the athlete's gels in turn. They differ by drink line and solid
 * when the athlete has more than one, and by how much of the carbs the drink and solid cover.
 * Above 90 g/h they prefer 1:0.8 products, else 2:1.
 */
export function defaultProposals(input: FuelPlanInput): ProposalSpec[] {
  const ratio = input.carbTarget >= 90 ? "1:0.8" : "2:1";
  const sorted = [...input.products].sort((a, b) => a.id.localeCompare(b.id));
  const byRole = (role: FuelRole) => sorted.filter((product) => rolesFor(product).includes(role));
  const preferRatio = (product: FuelProduct) => product.glucoseFructose === ratio;
  const better = (candidate: FuelProduct, current: FuelProduct | undefined) =>
    !current ||
    (preferRatio(candidate) && !preferRatio(current)) ||
    (preferRatio(candidate) === preferRatio(current) && carbsOf(candidate) > carbsOf(current));

  const drinksByLine = new Map<string, FuelProduct>();
  for (const drink of byRole("drink")) {
    const current = drinksByLine.get(drink.line);
    if (better(drink, current)) drinksByLine.set(drink.line, drink);
  }
  const drinks = [
    ...DRINK_LINE_ORDER.flatMap((line) => {
      const drink = drinksByLine.get(line);
      return drink ? [drink] : [];
    }),
    ...[...drinksByLine.values()].filter((drink) => !DRINK_LINE_ORDER.includes(drink.line)),
  ];

  const gels = byRole("gel");
  const gelA = pick(gels, preferRatio);
  const gelB = pick(
    gels.filter((product) => product.id !== gelA?.id),
    preferRatio,
  );
  const jellies = byRole("jelly");
  const jelly =
    pick(
      jellies.filter((product) => product.kind === "jelly"),
      preferRatio,
    ) ?? pick(jellies, preferRatio);
  const bar =
    input.sportGroup === "cycling" && input.elapsedSec >= BAR_MIN_ELAPSED_SEC
      ? pick(byRole("bar"), preferRatio)
      : null;
  const solids = [jelly, bar].filter((product): product is FuelProduct => product != null);
  const caffeine = pick(
    byRole("caffeine"),
    (product) =>
      preferRatio(product) && (product.caffeineMg ?? 0) <= CAFFEINE_MG_PER_KG * input.bodyWeightKg,
  );
  const ids = (...products: (FuelProduct | null)[]) =>
    products.flatMap((product) => (product ? [product.id] : []));

  const drinkList = drinks.length > 0 ? drinks : [null];
  const solidList = solids.length > 0 ? solids : [null];
  const gelList = [gelA, gelB ?? gelA];

  const proposals: ProposalSpec[] = [];
  for (const [index, style] of STYLES.entries()) {
    const drink = drinkList[index % drinkList.length] ?? null;
    const solid = solidList[index % solidList.length] ?? null;
    const gel = gelList[index % gelList.length] ?? null;
    if (!drink && !solid && !gel) break;
    const drinkShare = drink
      ? clamp((solid ? (carbsOf(drink) >= 75 ? 0.5 : 0.4) : 0.6) + style.drink, 0.2, 0.8)
      : 0;
    const solidShare = solid
      ? clamp((solid.kind === "bar" ? 0.15 : 0.2) + style.solid, 0.1, 0.5)
      : 0;
    const solidName =
      solid?.kind === "bar" ? "bar" : solid?.kind === "chew" ? "chews" : solid ? "jelly" : null;
    const drinkLabel = drink?.line || "Water";
    const base = solidName ? `${drinkLabel} + ${solidName}` : drinkLabel;
    proposals.push(
      withGelVariety(
        {
          id: `${drink ? slugLine(drink.line) : "water"}-${solidName ?? "gels"}-${index + 1}`,
          name: style.label ? `${base}, ${style.label}` : base,
          rationale: [
            drink ? `${drink.line} in the bottles` : "Water in the bottles",
            solid ? (solid.kind === "bar" ? "a bar early" : `${solid.line} as the solid`) : null,
            "gels before the climbs",
          ]
            .filter(Boolean)
            .join("; "),
          drinkId: drink?.id ?? null,
          drinkShare,
          gelIds: ids(gel),
          solidId: solid?.id ?? null,
          solidShare,
          caffeineId: caffeine?.id ?? null,
        },
        input.products,
      ),
    );
  }

  const seen = new Set<string>();
  return proposals.filter((proposal) => {
    const mix = [
      proposal.drinkId,
      proposal.solidId,
      proposal.caffeineId,
      proposal.drinkShare,
      proposal.solidShare,
      ...proposal.gelIds,
    ].join();
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
  const solid = roles.includes("bar") || roles.includes("jelly");
  return products.filter((product) => {
    if (product.id === productId || product.carbsG == null) return false;
    const theirs = rolesFor(product);
    if (theirs.some((role) => roles.includes(role))) return true;
    return solid && (theirs.includes("bar") || theirs.includes("jelly"));
  });
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
    solidId: swap(spec.solidId),
    caffeineId: swap(spec.caffeineId),
    gelIds: spec.gelIds.map((id) => swap(id) as string),
  });
}
